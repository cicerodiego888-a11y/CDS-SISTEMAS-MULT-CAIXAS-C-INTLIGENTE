/**
 * RC1.1 — Hardening Discovery Engine Ethernet
 * Executar: node tests/motor-equipamentos/rc11-hardening-discovery.test.js
 */

const assert = require('assert');
const {
  criarCandidate,
  criarDiscoveryResult,
  calcularAssinatura,
  validarCandidate,
  normalizarCapacidades,
  sanitizarCandidatos,
  CAPACIDADES_PADRAO,
  CHAVES_CAPACIDADES
} = require('../../backend/motores/equipamentos/discovery/CandidateDTO');
const {
  expandirHostsCidr,
  contarHostsCidr,
  parseCidr,
  probeTcp,
  mapPool,
  clamparConcorrencia,
  resetProbeStats,
  getProbeStats,
  CONCORRENCIA_MAX
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

function candidateBase(extra = {}) {
  return criarCandidate({
    transporte: 'ethernet',
    driver_codigo: 'TOLEDO_PRIX4_UNO',
    confianca: 0.9,
    origem: 'driver:TOLEDO_PRIX4_UNO',
    ip: '192.168.1.50',
    porta: 9100,
    modelo: 'Prix 4 Uno',
    firmware: '90AX',
    ...extra
  });
}

async function main() {
  console.log('\n=== RC1.1 — Hardening Discovery Engine ===\n');

  // ——— Assinatura ———
  await test('assinatura — estável para mesmo equipamento', () => {
    const a = calcularAssinatura({
      driver_codigo: 'TOLEDO_PRIX4_UNO', transporte: 'ethernet',
      ip: '10.0.0.1', porta: 9100, modelo: 'M', firmware: 'F1'
    });
    const b = calcularAssinatura({
      driver_codigo: 'TOLEDO_PRIX4_UNO', transporte: 'ethernet',
      ip: '10.0.0.1', porta: 9100, modelo: 'M', firmware: 'F1'
    });
    assert.strictEqual(a, b);
  });

  await test('assinatura — muda só com IP', () => {
    const base = {
      driver_codigo: 'TOLEDO_PRIX4_UNO', transporte: 'ethernet',
      porta: 9100, modelo: 'M', firmware: 'F1'
    };
    assert.notStrictEqual(
      calcularAssinatura({ ...base, ip: '10.0.0.1' }),
      calcularAssinatura({ ...base, ip: '10.0.0.2' })
    );
  });

  await test('assinatura — muda só com porta', () => {
    const base = {
      driver_codigo: 'TOLEDO_PRIX4_UNO', transporte: 'ethernet',
      ip: '10.0.0.1', modelo: 'M', firmware: 'F1'
    };
    assert.notStrictEqual(
      calcularAssinatura({ ...base, porta: 9100 }),
      calcularAssinatura({ ...base, porta: 4001 })
    );
  });

  await test('assinatura — muda só com firmware', () => {
    const base = {
      driver_codigo: 'TOLEDO_PRIX4_UNO', transporte: 'ethernet',
      ip: '10.0.0.1', porta: 9100, modelo: 'M'
    };
    assert.notStrictEqual(
      calcularAssinatura({ ...base, firmware: 'F1' }),
      calcularAssinatura({ ...base, firmware: 'F2' })
    );
  });

  await test('assinatura — baixa colisão em amostra', () => {
    const set = new Set();
    for (let i = 0; i < 200; i += 1) {
      set.add(calcularAssinatura({
        driver_codigo: 'TOLEDO_PRIX4_UNO',
        transporte: 'ethernet',
        ip: `192.168.1.${(i % 254) + 1}`,
        porta: i % 2 === 0 ? 9100 : 4001,
        modelo: 'Prix 4 Uno',
        firmware: `fw${i % 7}`
      }));
    }
    assert.strictEqual(set.size, 200);
  });

  // ——— Capacidades ———
  await test('capacidades — normalização padronizada', () => {
    const c = normalizarCapacidades({ discovery: 1, monitoramento: 'yes', foo: true });
    for (const k of CHAVES_CAPACIDADES) {
      assert.strictEqual(typeof c[k], 'boolean');
    }
    assert.strictEqual(c.discovery, true);
    assert.strictEqual(c.monitoramento, true);
    assert.strictEqual(c.configuracao, CAPACIDADES_PADRAO.configuracao);
    assert.strictEqual(c.foo, undefined);
  });

  // ——— Candidate DTO ———
  await test('Candidate — rejeita incompleto (sem ip ethernet)', () => {
    assert.throws(() => criarCandidate({
      transporte: 'ethernet',
      driver_codigo: 'X',
      confianca: 0.5,
      origem: 't',
      porta: 9100
    }), /Candidate incompleto/);
  });

  await test('Candidate — sanitizar descarta incompletos', () => {
    const { candidatos, rejeitados } = sanitizarCandidatos([
      candidateBase(),
      { transporte: 'ethernet', confianca: 1 },
      null
    ]);
    assert.strictEqual(candidatos.length, 1);
    assert.ok(rejeitados >= 2);
    assert.strictEqual(validarCandidate(candidatos[0]).length, 0);
  });

  await test('DiscoveryResult — só candidatos válidos', () => {
    const r = criarDiscoveryResult({
      sucesso: true,
      candidatos: [candidateBase(), { foo: 1 }],
      meta: {
        iniciado_em: new Date().toISOString(),
        finalizado_em: new Date().toISOString(),
        duracao_ms: 1,
        probes_total: 1,
        probes_ok: 1,
        transportes_executados: ['ethernet']
      }
    });
    assert.strictEqual(r.candidatos.length, 1);
    assert.ok(r.meta.candidatos_rejeitados >= 1);
  });

  // ——— Subnets / performance sizing ———
  await test('subnet sizing /24 /25 /26 /27', () => {
    assert.strictEqual(contarHostsCidr('192.168.0.0/24'), 254);
    assert.strictEqual(contarHostsCidr('192.168.0.0/25'), 126);
    assert.strictEqual(contarHostsCidr('192.168.0.0/26'), 62);
    assert.strictEqual(contarHostsCidr('192.168.0.0/27'), 30);
    assert.ok(parseCidr('10.0.0.0/24'));
    assert.strictEqual(parseCidr('nao-e-cidr'), null);
    assert.strictEqual(expandirHostsCidr('xyz').length, 0);
  });

  await test('auditoria performance — mapPool concorrência e pico', async () => {
    const hosts = expandirHostsCidr('10.0.0.0/27'); // 30
    let pico = 0;
    const inicio = Date.now();
    await mapPool(hosts, 8, async () => {
      await new Promise((r) => setTimeout(r, 15));
      return true;
    }, { onInFlight: (n) => { if (n > pico) pico = n; } });
    const duracao = Date.now() - inicio;
    assert.ok(pico <= 8, `pico=${pico}`);
    assert.ok(mapPool._ultimoPicoInFlight <= 8);
    assert.ok(duracao < 5000, `duracao=${duracao}`);
    console.log(`         [/27 sim] hosts=${hosts.length} pico=${pico} duracao_ms=${duracao}`);
  });

  await test('auditoria performance — tempos teóricos CIDR', () => {
    const timeoutMs = 800;
    const concorrencia = 32;
    const portas = 2;
    for (const bits of [24, 25, 26, 27]) {
      const hosts = contarHostsCidr(`192.168.10.0/${bits}`);
      const probes = hosts * portas;
      const teoricoMs = Math.ceil((probes * timeoutMs) / concorrencia);
      console.log(`         [/${bits}] hosts=${hosts} probes=${probes} pior_caso_ms≈${teoricoMs}`);
      assert.ok(hosts > 0);
    }
  });

  await test('concorrência — clamp máximo', () => {
    assert.strictEqual(clamparConcorrencia(9999), CONCORRENCIA_MAX);
    assert.strictEqual(clamparConcorrencia(0), 1);
    assert.strictEqual(clamparConcorrencia(-5), 1);
  });

  await test('scanner — timeout extremo não vaza socket', async () => {
    resetProbeStats();
    const r = await probeTcp('127.0.0.1', 1, 50);
    assert.strictEqual(r.ok, false);
    const s = getProbeStats();
    assert.strictEqual(s.abertos, 0);
    assert.strictEqual(s.total_criados, s.total_fechados);
  });

  await test('mapPool — worker com throw não derruba varredura', async () => {
    const out = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    assert.strictEqual(out[0], 1);
    assert.strictEqual(out[1], null);
    assert.strictEqual(out[2], 3);
  });

  // ——— Robustez Toledo ———
  let mockOk;
  let mockLixo;

  await test('robustez — porta fechada / IP inexistente não interrompe', async () => {
    const d = new ToledoPrix4Discovery();
    const r = await d.descobrir({
      hosts: ['127.0.0.1', '203.0.113.1'],
      portas: [1, 2],
      timeoutMs: 80,
      concorrencia: 4
    });
    assert.ok(Array.isArray(r.candidatos));
    assert.ok(r.meta.probes_total === 4);
  });

  await test('robustez — handshake OK + resposta corrompida', async () => {
    mockOk = new MockTcpServer();
    await mockOk.iniciar({ modoToledo: true });
    mockLixo = new MockTcpServer();
    await mockLixo.iniciar({
      echo: false,
      onConnect: (socket) => {
        socket.on('data', () => {
          socket.write(Buffer.from([0xff, 0x00, 0xde, 0xad]));
        });
      }
    });

    const d = new ToledoPrix4Discovery();
    const r = await d.descobrir({
      hosts: ['127.0.0.1'],
      portas: [mockOk.port, mockLixo.port],
      timeoutMs: 1200,
      concorrencia: 4
    });
    assert.ok(r.candidatos.length >= 1);
    for (const c of r.candidatos) {
      assert.strictEqual(validarCandidate(c).length, 0);
      assert.ok(c.assinatura);
      assert.ok(c.capacidades.discovery === true);
    }
  });

  await test('múltiplas balanças simultâneas', async () => {
    const a = new MockTcpServer();
    const b = new MockTcpServer();
    await a.iniciar({ modoToledo: true });
    await b.iniciar({ modoToledo: true });
    try {
      const d = new ToledoPrix4Discovery();
      const r = await d.descobrir({
        hosts: ['127.0.0.1'],
        portas: [a.port, b.port],
        timeoutMs: 1500,
        concorrencia: 4
      });
      assert.ok(r.candidatos.length >= 2);
      const assinaturas = new Set(r.candidatos.map((c) => c.assinatura));
      assert.strictEqual(assinaturas.size, r.candidatos.length);
    } finally {
      await a.parar();
      await b.parar();
    }
  });

  await test('duas varreduras consecutivas — mesma assinatura', async () => {
    if (!mockOk) {
      mockOk = new MockTcpServer();
      await mockOk.iniciar({ modoToledo: true });
    }
    driverLoader.carregarTodos();
    const opts = {
      subnet: '127.0.0.1/32',
      hosts: ['127.0.0.1'],
      portas: [mockOk.port],
      timeoutMs: 1500,
      concorrencia: 4,
      driver_codigos: ['TOLEDO_PRIX4_UNO']
    };
    const r1 = await discoveryService.descobrirEthernet(opts);
    const r2 = await discoveryService.descobrirEthernet(opts);
    assert.ok(r1.candidatos.length >= 1);
    assert.ok(r2.candidatos.length >= 1);
    const c1 = r1.candidatos.find((c) => Number(c.porta) === mockOk.port);
    const c2 = r2.candidatos.find((c) => Number(c.porta) === mockOk.port);
    assert.ok(c1 && c2);
    assert.strictEqual(c1.assinatura, c2.assinatura);
    assert.strictEqual(c1.driver_codigo, c2.driver_codigo);
    assert.ok(typeof c1.ja_cadastrado === 'boolean');
    assert.ok(r1.candidatos[0].confianca >= r1.candidatos[r1.candidatos.length - 1].confianca);
    assert.strictEqual(r1.meta.sockets_probe_abertos, 0);
  });

  await test('rede sem equipamentos', async () => {
    const r = await discoveryService.descobrirEthernet({
      subnet: '127.0.0.1/32',
      hosts: ['127.0.0.1'],
      portas: [1],
      timeoutMs: 80,
      concorrencia: 4,
      driver_codigos: ['TOLEDO_PRIX4_UNO']
    });
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(r.candidatos.length, 0);
    assert.ok(Array.isArray(r.erros));
  });

  await test('subnet inválida — não derruba processo', async () => {
    const r = await discoveryService.descobrirEthernet({ subnet: 'invalida' });
    assert.strictEqual(r.sucesso, false);
    assert.ok(r.erros.some((e) => e.codigo === 'SUBNET_INVALIDA'));
  });

  await test('API — payload vazio / inválido / cancel', async () => {
    const ctrl = require('../../backend/controllers/equipamentosController');
    const mkRes = () => {
      let status = 200;
      let body = null;
      return {
        status(c) { status = c; return this; },
        json(d) { body = d; return this; },
        get statusCode() { return status; },
        get body() { return body; }
      };
    };

    // inválido
    const resInv = mkRes();
    await ctrl.discovery({ body: { subnet: 'x.y/zz' } }, resInv);
    assert.ok(resInv.body);
    assert.strictEqual(resInv.body.sucesso, false);

    // concorrência absurda normalizada (não explode)
    if (!mockOk) {
      mockOk = new MockTcpServer();
      await mockOk.iniciar({ modoToledo: true });
    }
    const resOk = mkRes();
    await ctrl.discovery({
      body: {
        hosts: ['127.0.0.1'],
        portas: [mockOk.port],
        timeoutMs: 1500,
        concorrencia: 99999,
        subnet: '127.0.0.1/32',
        driver_codigos: ['TOLEDO_PRIX4_UNO']
      }
    }, resOk);
    assert.ok(resOk.body.candidatos);
    assert.ok(resOk.body.meta.concorrencia <= CONCORRENCIA_MAX);

    const resCancel = mkRes();
    await ctrl.discoveryCancelar({ body: {} }, resCancel);
    assert.strictEqual(resCancel.body.cancelado, true);
  });

  await test('deduplicação de candidatos duplicados', () => {
    const svc = new discoveryService.DiscoveryService();
    const a = candidateBase({ confianca: 0.4, assinatura: 'dup1' });
    const b = candidateBase({ confianca: 0.95, assinatura: 'dup1', observacoes: 'melhor' });
    const c = candidateBase({ ip: '192.168.1.51', confianca: 0.5 });
    const out = svc._deduplicar([a, b, c]);
    assert.strictEqual(out.filter((x) => x.assinatura === 'dup1').length, 1);
    assert.strictEqual(out.find((x) => x.assinatura === 'dup1').confianca, 0.95);
  });

  if (mockOk) await mockOk.parar().catch(() => {});
  if (mockLixo) await mockLixo.parar().catch(() => {});

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
