/**
 * Testes RC2 — Painel de Diagnóstico da Central de Entradas
 * Executar: npm run test:central-entradas-rc2
 */

const assert = require('assert');

const CentralDiagnosticoService = require('../../backend/motores/central-entradas/services/CentralDiagnosticoService');
const { exigirDiagnosticoCentral } = require('../../backend/middleware/auth');
const orchestrator = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
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
  console.log('\n=== Testes RC2 — Diagnóstico Central de Entradas ===\n');

  const service = new CentralDiagnosticoService();

  await test('CentralDiagnosticoService retorna painel com 13 seções', async () => {
    const painel = await service.obterPainelCompleto({ forcarAtualizacao: true });
    assert.ok(painel.statusGeral, 'statusGeral ausente');
    assert.ok(painel.sefaz, 'sefaz ausente');
    assert.ok(painel.certificado, 'certificado ausente');
    assert.ok(painel.pipeline?.length >= 8, 'pipeline incompleto');
    assert.ok(painel.documentos, 'documentos ausente');
    assert.ok(painel.miip, 'miip ausente');
    assert.ok(painel.servicos, 'servicos ausente');
    assert.ok(painel.banco, 'banco ausente');
    assert.ok(painel.performance, 'performance ausente');
    assert.ok(Array.isArray(painel.logs), 'logs ausente');
    assert.ok(painel.healthCheck?.itens?.length >= 8, 'healthCheck incompleto');
    assert.ok(painel.sistema?.versaoCentral, 'sistema ausente');
    assert.ok(/^1\.0\.0-rc[2-9]/.test(painel.versaoPainel), `versaoPainel: ${painel.versaoPainel}`);
  });

  await test('certificado nunca expõe senha', async () => {
    const painel = await service.obterPainelCompleto({ forcarAtualizacao: true });
    const json = JSON.stringify(painel.certificado);
    assert.ok(!/"senha"\s*:/i.test(json), 'campo senha exposto');
    assert.ok(!json.includes('1234'), 'valor de senha exposto');
    assert.ok(['SIM', 'NÃO'].includes(painel.certificado.senhaConfigurada));
  });

  await test('logs sanitizam XML e dados sensíveis', async () => {
    const logs = await service._obterLogs();
    logs.forEach((log) => {
      const msg = String(log.mensagem || '');
      assert.ok(!msg.includes('<?xml'), 'XML em log');
      assert.ok(!/senha\s*[:=]/i.test(msg), 'senha em log');
    });
  });

  await test('health check retorna componentes esperados', async () => {
    const health = await service.executarHealthCheck();
    const nomes = health.itens.map((i) => i.componente);
    ['Central', 'SEFAZ', 'SOAP', 'MIIP', 'Parser', 'Banco', 'Scheduler', 'Upload', 'Bridge', 'Compras']
      .forEach((nome) => assert.ok(nomes.includes(nome), `componente ${nome} ausente`));
  });

  await test('limpar cache não lança erro', async () => {
    await service.obterPainelCompleto();
    const resultado = service.limparCache();
    assert.strictEqual(resultado.sucesso, true);
  });

  await test('orchestrator expõe obterDiagnostico', async () => {
    const painel = await orchestrator.obterDiagnostico({ forcarAtualizacao: true });
    assert.ok(painel.geradoEm);
    assert.ok(painel.statusGeral.centralInteligente);
  });

  await test('health RC2 expõe sprint RC2', async () => {
    const health = await orchestrator.obterHealth();
    assert.ok(/^RC[2-9]$/.test(health.sprint), `health.sprint: ${health.sprint}`);
    assert.ok(/^1\.0\.0-rc[2-9]/.test(health.versao), `health.versao: ${health.versao}`);
  });

  await test('perfis permitidos incluem SUPORTE', () => {
    assert.ok(CentralDiagnosticoService.PERFIS_PERMITIDOS.includes('SUPORTE'));
    assert.ok(CentralDiagnosticoService.PERFIS_PERMITIDOS.includes('ADMIN'));
    assert.ok(CentralDiagnosticoService.PERFIS_PERMITIDOS.includes('SUPER_ADMIN'));
  });

  await test('exigirDiagnosticoCentral é função exportada', () => {
    assert.strictEqual(typeof exigirDiagnosticoCentral, 'function');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
