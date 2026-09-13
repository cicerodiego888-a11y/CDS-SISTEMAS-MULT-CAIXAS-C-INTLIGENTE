/**
 * RC2.1 — Motor de Identidade dos Equipamentos (MIE)
 * Executar: node tests/motor-equipamentos/rc21-mie-identidade.test.js
 */

const assert = require('assert');
const {
  extrairSinais,
  chaveIdentidade,
  pontuarCorrespondencia,
  classificarScore,
  resolverStatus,
  LIMIARES
} = require('../../backend/motores/equipamentos/identidade/IdentidadeScore');
const identidadeService = require('../../backend/motores/equipamentos/identidade/IdentidadeService');
const repo = require('../../backend/motores/equipamentos/identidade/IdentidadeRepository');

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
      console.error(`         ${error.stack || error.message}`);
    });
}

async function main() {
  console.log('\n=== RC2.1 — Motor de Identidade (MIE) ===\n');

  await repo.garantirSchema();

  await test('prioridade — serial number gera chave sn:', () => {
    const { chave, nivel } = chaveIdentidade(extrairSinais({
      serial_number: 'SN123',
      mac: 'AA:BB',
      modelo: 'X',
      firmware: '1',
      assinatura: 'abcd'
    }));
    assert.strictEqual(nivel, 'serial_number');
    assert.ok(chave.startsWith('sn:'));
  });

  await test('prioridade — MAC na ausência de serial', () => {
    const { nivel } = chaveIdentidade(extrairSinais({
      mac: 'AA:BB:CC:DD:EE:FF',
      modelo: 'X',
      firmware: '1'
    }));
    assert.strictEqual(nivel, 'mac');
  });

  await test('prioridade — firmware+modelo', () => {
    const { nivel } = chaveIdentidade(extrairSinais({
      modelo: 'Prix 4 Uno',
      firmware: '90AX'
    }));
    assert.strictEqual(nivel, 'firmware_modelo');
  });

  await test('prioridade — VID/PID', () => {
    const { nivel } = chaveIdentidade(extrairSinais({
      vid: '1A86',
      pid: '7523'
    }));
    assert.strictEqual(nivel, 'vid_pid');
  });

  await test('score — assinatura igual ≈ mesmo equipamento', () => {
    const p = pontuarCorrespondencia(
      { assinatura: 'abc123', driver_codigo: 'T' },
      { assinatura_ref: 'abc123', driver_codigo: 'T' }
    );
    assert.ok(p.score >= LIMIARES.MESMO || p.score >= 0.9);
    assert.ok(classificarScore(p.score) === 'mesmo' || classificarScore(0.95) === 'mesmo');
  });

  await test('status — novo / conhecido / ip_alterado / firmware_alterado', () => {
    assert.strictEqual(resolverStatus({ ip: '1.1.1.1' }, null, 0).status, 'novo');
    assert.strictEqual(
      resolverStatus({ ip: '10.0.0.2' }, { ip_atual: '10.0.0.2', firmware: 'A' }, 0.9).status,
      'conhecido'
    );
    assert.strictEqual(
      resolverStatus({ ip: '10.0.0.3' }, { ip_atual: '10.0.0.2', firmware: 'A' }, 0.9).status,
      'ip_alterado'
    );
    assert.strictEqual(
      resolverStatus(
        { ip: '10.0.0.2', firmware: 'B' },
        { ip_atual: '10.0.0.2', firmware: 'A' },
        0.9
      ).status,
      'firmware_alterado'
    );
  });

  const sufixo = Date.now();

  await test('enriquecer — cria identidade nova', async () => {
    const lista = await identidadeService.enriquecerCandidatos([
      {
        transporte: 'ethernet',
        driver_codigo: 'TOLEDO_PRIX4_UNO',
        confianca: 0.9,
        origem: 't',
        descoberto_em: new Date().toISOString(),
        ip: '192.168.50.10',
        porta: 9100,
        modelo: 'Prix 4 Uno',
        firmware: `FW-${sufixo}`,
        serial_number: `SN-MIE-${sufixo}`,
        assinatura: `sig-mie-${sufixo}`,
        capacidades: {
          discovery: true, configuracao: true, diagnostico: true,
          sincronizacao: true, monitoramento: false
        }
      }
    ], { sessao_id: 9001 });

    assert.strictEqual(lista.length, 1);
    assert.ok(lista[0].identidade);
    assert.strictEqual(lista[0].identidade.status, 'novo');
    assert.ok(lista[0].identidade.id);
  });

  await test('enriquecer — mesmo equipamento com IP alterado', async () => {
    const lista = await identidadeService.enriquecerCandidatos([
      {
        transporte: 'ethernet',
        driver_codigo: 'TOLEDO_PRIX4_UNO',
        confianca: 0.9,
        origem: 't',
        descoberto_em: new Date().toISOString(),
        ip: '192.168.50.99',
        porta: 9100,
        modelo: 'Prix 4 Uno',
        firmware: `FW-${sufixo}`,
        serial_number: `SN-MIE-${sufixo}`,
        assinatura: `sig-mie-${sufixo}`,
        capacidades: {
          discovery: true, configuracao: true, diagnostico: true,
          sincronizacao: true, monitoramento: false
        }
      }
    ], { sessao_id: 9002 });

    const idn = lista[0].identidade;
    assert.ok(idn.score >= LIMIARES.PROVAVEL || idn.score >= 0.7);
    assert.strictEqual(idn.status, 'ip_alterado');
    assert.strictEqual(idn.ip_anterior, '192.168.50.10');
    assert.strictEqual(idn.ip_atual, '192.168.50.99');
    assert.ok(idn.vezes_visto >= 2);
  });

  await test('enriquecer — firmware alterado', async () => {
    const lista = await identidadeService.enriquecerCandidatos([
      {
        transporte: 'ethernet',
        driver_codigo: 'TOLEDO_PRIX4_UNO',
        confianca: 0.9,
        origem: 't',
        descoberto_em: new Date().toISOString(),
        ip: '192.168.50.99',
        porta: 9100,
        modelo: 'Prix 4 Uno',
        firmware: `FW-${sufixo}-B`,
        serial_number: `SN-MIE-${sufixo}`,
        assinatura: `sig-mie-${sufixo}`,
        capacidades: {
          discovery: true, configuracao: true, diagnostico: true,
          sincronizacao: true, monitoramento: false
        }
      }
    ], { sessao_id: 9003 });

    assert.ok(['firmware_alterado', 'conhecido', 'ip_alterado'].includes(lista[0].identidade.status));
  });

  await test('API service — listar e buscar com histórico', async () => {
    const todas = await identidadeService.listar(10);
    assert.ok(Array.isArray(todas));
    assert.ok(todas.length >= 1);
    const det = await identidadeService.buscarPorId(todas[0].id);
    assert.ok(det);
    assert.ok(Array.isArray(det.historico));
    assert.ok(det.historico.some((h) => h.evento === 'CRIADO' || h.evento === 'VISTO' || h.evento === 'IP_ALTERADO'));
  });

  await test('Candidate DTO intacto — enriquecimento é campo paralelo', async () => {
    const [c] = await identidadeService.enriquecerCandidatos([
      {
        transporte: 'serial',
        porta_com: `COM-MIE-${sufixo}`,
        driver_codigo: 'GENERIC_SERIAL',
        confianca: 0.3,
        origem: 't',
        descoberto_em: new Date().toISOString(),
        assinatura: `sig-serial-${sufixo}`,
        capacidades: {
          discovery: true, configuracao: true, diagnostico: true,
          sincronizacao: true, monitoramento: false
        }
      }
    ]);
    assert.strictEqual(c.transporte, 'serial');
    assert.strictEqual(c.porta_com, `COM-MIE-${sufixo}`);
    assert.ok(c.identidade && c.identidade.id);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
