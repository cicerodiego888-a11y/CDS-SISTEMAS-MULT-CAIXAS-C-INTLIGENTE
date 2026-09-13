/**
 * RC1.0 — Discovery Engine Ethernet
 * Executar: node tests/motor-equipamentos/rc1-discovery-ethernet.test.js
 */

const assert = require('assert');
const {
  criarCandidate,
  criarDiscoveryResult,
  calcularAssinatura,
  CAPACIDADES_PADRAO
} = require('../../backend/motores/equipamentos/discovery/CandidateDTO');
const {
  expandirHostsCidr,
  parseCidr,
  probeTcp,
  mapPool,
  interfaceEhVirtual,
  listarSubnetsLocais
} = require('../../backend/motores/equipamentos/discovery/networkUtils');
const ToledoPrix4Discovery = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Discovery');
const discoveryService = require('../../backend/motores/equipamentos/discovery/DiscoveryService');
const driverLoader = require('../../backend/motores/equipamentos/drivers/DriverLoader');
const MockTcpServer = require('./helpers/MockTcpServer');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

async function main() {
  console.log('\n=== RC1.0 — Discovery Engine Ethernet ===\n');

  await test('Candidate DTO — campos obrigatórios + capacidades + assinatura', () => {
    const c = criarCandidate({
      transporte: 'ethernet',
      driver_codigo: 'TOLEDO_PRIX4_UNO',
      confianca: 0.9,
      origem: 'driver:TOLEDO_PRIX4_UNO',
      ip: '192.168.1.50',
      porta: 9100,
      modelo: 'Prix 4 Uno',
      firmware: '90AX'
    });
    assert.strictEqual(c.transporte, 'ethernet');
    assert.strictEqual(c.driver_codigo, 'TOLEDO_PRIX4_UNO');
    assert.strictEqual(c.confianca, 0.9);
    assert.ok(c.origem);
    assert.ok(c.descoberto_em);
    assert.strictEqual(c.ip, '192.168.1.50');
    assert.strictEqual(c.porta, 9100);
    assert.ok(c.capacidades.discovery === true);
    assert.ok(c.capacidades.configuracao === CAPACIDADES_PADRAO.configuracao);
    assert.ok(typeof c.assinatura === 'string' && c.assinatura.length === 16);
    assert.strictEqual(
      c.assinatura,
      calcularAssinatura({
        driver_codigo: c.driver_codigo,
        transporte: c.transporte,
        ip: c.ip,
        porta: c.porta,
        modelo: c.modelo,
        firmware: c.firmware
      })
    );
  });

  await test('DiscoveryResult — meta obrigatória', () => {
    const r = criarDiscoveryResult({
      sucesso: true,
      candidatos: [],
      erros: [],
      meta: {
        iniciado_em: '2026-01-01T00:00:00.000Z',
        finalizado_em: '2026-01-01T00:00:01.000Z',
        duracao_ms: 1000,
        probes_total: 10,
        probes_ok: 1,
        transportes_executados: ['ethernet']
      }
    });
    assert.strictEqual(r.sucesso, true);
    assert.ok(Array.isArray(r.candidatos));
    assert.ok(Array.isArray(r.erros));
    assert.strictEqual(r.meta.probes_total, 10);
    assert.strictEqual(r.meta.probes_ok, 1);
    assert.deepStrictEqual(r.meta.transportes_executados, ['ethernet']);
  });

  await test('subnet — parseCidr e expandirHostsCidr', () => {
    const p = parseCidr('192.168.10.5/24');
    assert.ok(p);
    assert.strictEqual(p.bits, 24);
    const hosts = expandirHostsCidr('192.168.10.5/24');
    assert.strictEqual(hosts.length, 254);
    assert.strictEqual(hosts[0], '192.168.10.1');
    assert.strictEqual(hosts[hosts.length - 1], '192.168.10.254');
    assert.ok(!hosts.includes('192.168.10.0'));
    assert.ok(!hosts.includes('192.168.10.255'));
  });

  await test('subnet — /16 é limitado a /24', () => {
    const hosts = expandirHostsCidr('10.0.5.20/16');
    assert.ok(hosts.length <= 254);
    assert.ok(hosts.every((h) => h.startsWith('10.0.5.')));
  });

  await test('interfaces virtuais filtradas', () => {
    assert.strictEqual(interfaceEhVirtual('docker0'), true);
    assert.strictEqual(interfaceEhVirtual('vEthernet (Default Switch)'), true);
    assert.strictEqual(interfaceEhVirtual('VMware Network Adapter VMnet1'), true);
    assert.strictEqual(interfaceEhVirtual('Ethernet'), false);
  });

  await test('listarSubnetsLocais — retorna array', () => {
    const subnets = listarSubnetsLocais();
    assert.ok(Array.isArray(subnets));
  });

  await test('scanner — probeTcp timeout em porta fechada', async () => {
    const inicio = Date.now();
    const r = await probeTcp('127.0.0.1', 1, 200);
    assert.strictEqual(r.ok, false);
    assert.ok(Date.now() - inicio < 2000);
  });

  await test('scanner — probeTcp connect em MockTcpServer', async () => {
    const mock = new MockTcpServer();
    await mock.iniciar();
    try {
      const r = await probeTcp('127.0.0.1', mock.port, 500);
      assert.strictEqual(r.ok, true);
    } finally {
      await mock.parar();
    }
  });

  await test('mapPool — concorrência e cancelamento', async () => {
    const itens = [1, 2, 3, 4, 5];
    let cancelar = false;
    const out = await mapPool(itens, 2, async (n) => {
      if (n === 3) cancelar = true;
      await new Promise((r) => setTimeout(r, 20));
      return n * 10;
    }, { cancelado: () => cancelar });
    assert.ok(out.filter((x) => x != null).length >= 2);
  });

  let mockToledo;
  await test('ToledoPrix4Discovery — candidato encontrado via MockTcpServer', async () => {
    mockToledo = new MockTcpServer();
    await mockToledo.iniciar({ modoToledo: true });
    const discovery = new ToledoPrix4Discovery();
    const resultado = await discovery.descobrir({
      hosts: ['127.0.0.1'],
      portas: [mockToledo.port],
      timeoutMs: 1500,
      concorrencia: 4
    });
    assert.ok(resultado.candidatos.length >= 1);
    const c = resultado.candidatos[0];
    assert.strictEqual(c.ip, '127.0.0.1');
    assert.strictEqual(c.porta, mockToledo.port);
    assert.strictEqual(c.driver_codigo, 'TOLEDO_PRIX4_UNO');
    assert.ok(c.confianca >= 0.3);
    assert.ok(c.assinatura);
    assert.ok(c.capacidades.discovery);
    assert.ok(resultado.meta.probes_total >= 1);
    assert.ok(resultado.meta.probes_ok >= 1);
  });

  await test('DiscoveryService — deduplicação e ordenação por confiança', async () => {
    driverLoader.carregarTodos();
    const svc = new discoveryService.DiscoveryService();
    const a = criarCandidate({
      transporte: 'ethernet', ip: '10.0.0.1', porta: 9100,
      driver_codigo: 'TOLEDO_PRIX4_UNO', confianca: 0.3, origem: 't'
    });
    const b = criarCandidate({
      transporte: 'ethernet', ip: '10.0.0.1', porta: 9100,
      driver_codigo: 'TOLEDO_PRIX4_UNO', confianca: 0.9, origem: 't',
      modelo: 'X', firmware: '1'
    });
    // assinaturas diferentes se modelo/firmware mudam — forçar mesma chave via mesma assinatura
    const cBaixa = criarCandidate({
      transporte: 'ethernet', ip: '10.0.0.2', porta: 9100,
      driver_codigo: 'TOLEDO_PRIX4_UNO', confianca: 0.4, origem: 't',
      assinatura: 'aaa'
    });
    const cAlta = criarCandidate({
      transporte: 'ethernet', ip: '10.0.0.2', porta: 9100,
      driver_codigo: 'TOLEDO_PRIX4_UNO', confianca: 0.95, origem: 't',
      assinatura: 'aaa'
    });
    const cOutro = criarCandidate({
      transporte: 'ethernet', ip: '10.0.0.3', porta: 9100,
      driver_codigo: 'TOLEDO_PRIX4_UNO', confianca: 0.5, origem: 't'
    });
    const dedup = svc._deduplicar([cBaixa, cAlta, cOutro, a, b]);
    const comMesmaAssinatura = dedup.filter((x) => x.assinatura === 'aaa');
    assert.strictEqual(comMesmaAssinatura.length, 1);
    assert.strictEqual(comMesmaAssinatura[0].confianca, 0.95);
    dedup.sort((x, y) => Number(y.confianca) - Number(x.confianca));
    assert.ok(dedup[0].confianca >= dedup[dedup.length - 1].confianca);
  });

  await test('DiscoveryService.descobrirEthernet — hosts fixos + Mock Toledo', async () => {
    if (!mockToledo) {
      mockToledo = new MockTcpServer();
      await mockToledo.iniciar({ modoToledo: true });
    }
    const resultado = await discoveryService.descobrirEthernet({
      subnet: '127.0.0.1/32',
      hosts: ['127.0.0.1'],
      portas: [mockToledo.port],
      timeoutMs: 1500,
      concorrencia: 4,
      driver_codigos: ['TOLEDO_PRIX4_UNO']
    });
    assert.strictEqual(resultado.sucesso, true);
    assert.ok(Array.isArray(resultado.candidatos));
    assert.ok(resultado.meta.transportes_executados.includes('ethernet'));
    assert.ok(resultado.meta.iniciado_em);
    assert.ok(resultado.meta.finalizado_em);
    assert.ok('duracao_ms' in resultado.meta);
    const hit = resultado.candidatos.find((c) => c.ip === '127.0.0.1' && Number(c.porta) === mockToledo.port);
    assert.ok(hit, 'esperava candidato Toledo no MockTcpServer');
    assert.ok(typeof hit.ja_cadastrado === 'boolean');
  });

  await test('API POST /api/equipamentos/discovery', async () => {
    if (!mockToledo) {
      mockToledo = new MockTcpServer();
      await mockToledo.iniciar({ modoToledo: true });
    }
    const equipamentosController = require('../../backend/controllers/equipamentosController');

    const req = {
      body: {
        hosts: ['127.0.0.1'],
        portas: [mockToledo.port],
        timeoutMs: 1500,
        concorrencia: 4,
        subnet: '127.0.0.1/32',
        driver_codigos: ['TOLEDO_PRIX4_UNO']
      }
    };

    let statusCode = 200;
    let payload = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        payload = data;
        return this;
      }
    };

    await equipamentosController.discovery(req, res);
    assert.ok(statusCode === 200, `status=${statusCode} payload=${JSON.stringify(payload)}`);
    assert.ok(payload);
    assert.ok(payload.sucesso !== false);
    assert.ok(Array.isArray(payload.candidatos));
    assert.ok(payload.meta);
    assert.ok(payload.candidatos.some((c) => c.ip === '127.0.0.1'));
  });

  if (mockToledo) {
    await mockToledo.parar().catch(() => {});
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
