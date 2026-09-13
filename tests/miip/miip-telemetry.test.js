/**
 * Testes — MIIP Telemetria e Observabilidade (Sprint 14)
 * Executar: npm run test:miip-telemetry
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MiipHealthStatus = require('../../backend/motores/miip/core/MiipHealthStatus');
const MiipPerformanceMetrics = require('../../backend/motores/miip/core/MiipPerformanceMetrics');
const MiipExecutionReport = require('../../backend/motores/miip/core/MiipExecutionReport');
const MiipTelemetryService = require('../../backend/motores/miip/services/MiipTelemetryService');
const MiipMonitoringService = require('../../backend/motores/miip/services/MiipMonitoringService');
const MiipDiagnosticService = require('../../backend/motores/miip/services/MiipDiagnosticService');
const { MiipMetricsCollector } = require('../../backend/motores/miip/metrics/MiipMetricsCollector');
const { MiipMotorLogService } = require('../../backend/motores/miip/logs/MiipMotorLogService');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');

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

function criarTelemetry() {
  const metrics = new MiipMetricsCollector();
  const logs = new MiipMotorLogService();
  metrics.reiniciar();
  logs.reiniciar();
  return new MiipTelemetryService({ metricsCollector: metrics, logService: logs });
}

async function main() {
  console.log('\n=== Testes MIIP Telemetria — Sprint 14 ===\n');

  await test('MiipHealthStatus define OK, WARNING, ERROR', () => {
    assert.ok(MiipHealthStatus.isValid('OK'));
    assert.ok(MiipHealthStatus.isValid('WARNING'));
    assert.ok(MiipHealthStatus.isValid('ERROR'));
    assert.strictEqual(MiipHealthStatus.consolidar('OK', 'WARNING'), 'WARNING');
    assert.strictEqual(MiipHealthStatus.consolidar('OK', 'ERROR'), 'ERROR');
  });

  await test('MiipPerformanceMetrics calcula média e extremos', () => {
    const metricas = MiipPerformanceMetrics.calcular([
      { tempoTotal: 100, tempoPorEngine: { motor_gtin: 50 } },
      { tempoTotal: 200, tempoPorEngine: { motor_gtin: 80 } },
      { tempoTotal: 150, tempoPorEngine: { motor_fornecedor: 60 } }
    ]);
    assert.strictEqual(metricas.tempoMedio, 150);
    assert.strictEqual(metricas.tempoMaximo, 200);
    assert.strictEqual(metricas.tempoMinimo, 100);
    assert.strictEqual(metricas.totalExecucoes, 3);
    assert.ok(metricas.tempoPorEngine.motor_gtin);
  });

  await test('MiipExecutionReport serializa campos obrigatórios', () => {
    const report = MiipExecutionReport.create({
      requestId: 'req-1',
      enginesExecutados: ['motor_gtin'],
      tempoTotal: 120,
      decisao: 'AUTO_ASSOCIAR',
      nivelConfianca: 'ALTA',
      explicacao: { titulo: 'OK' }
    });
    const json = report.toJSON();
    assert.strictEqual(json.requestId, 'req-1');
    assert.ok(json.explicacao);
    assert.ok(report.isCompleto());
  });

  await test('MiipTelemetryService inicia execução com requestId', () => {
    const tel = criarTelemetry();
    const id = tel.iniciarExecucao();
    assert.ok(id.startsWith('miip-tel-'));
  });

  await test('MiipTelemetryService registra motor e tempo', () => {
    const tel = criarTelemetry();
    const id = tel.iniciarExecucao({ requestId: 'test-1' });
    tel.registrarEngine(id, { motor: 'motor_gtin', tempoMs: 45, encontrado: true });
    const report = tel.finalizarExecucao(id, {
      tempoTotal: 50,
      decisao: 'AUTO_ASSOCIAR',
      scoreFinal: 100,
      quantidadeCandidatos: 1
    });
    assert.strictEqual(report.tempoPorEngine.motor_gtin, 45);
    assert.deepStrictEqual(report.enginesExecutados, ['motor_gtin']);
  });

  await test('MiipTelemetryService registra erro de motor', () => {
    const tel = criarTelemetry();
    const report = tel.registrarExecucao({
      requestId: 'err-1',
      engines: [{ motor: 'motor_gtin', tempoMs: 10, erro: true, mensagem: 'falha_sql' }],
      tempoTotal: 15,
      decisao: 'CADASTRAR_NOVO'
    });
    assert.strictEqual(report.health, MiipHealthStatus.ERROR);
    assert.strictEqual(report.errors.length, 1);
  });

  await test('MiipTelemetryService registra timeout como warning', () => {
    const tel = criarTelemetry();
    const report = tel.registrarExecucao({
      engines: [{ motor: 'motor_gtin', tempoMs: 5000, timeout: true }],
      tempoTotal: 5000,
      decisao: 'CADASTRAR_NOVO'
    });
    assert.strictEqual(report.health, MiipHealthStatus.WARNING);
    assert.ok(report.warnings.some((w) => w.includes('Timeout')));
  });

  await test('MiipTelemetryService inclui explicação no relatório', () => {
    const tel = criarTelemetry();
    const report = tel.registrarExecucao({
      decisao: 'SUGERIR_CONFIRMACAO',
      explicacao: { titulo: 'Confirme', resumo: 'Alta confiança' },
      tempoTotal: 80
    });
    assert.ok(report.explicacao);
    assert.strictEqual(report.explicacao.titulo, 'Confirme');
  });

  await test('MiipTelemetryService acumula histórico', () => {
    const tel = criarTelemetry();
    tel.registrarExecucao({ tempoTotal: 10, decisao: 'A' });
    tel.registrarExecucao({ tempoTotal: 20, decisao: 'B' });
    assert.strictEqual(tel.obterHistorico().length, 2);
  });

  await test('MiipMonitoringService analisa métricas', () => {
    const tel = criarTelemetry();
    tel.registrarExecucao({ tempoTotal: 100, engines: [{ motor: 'motor_gtin', tempoMs: 40 }] });
    tel.registrarExecucao({ tempoTotal: 200, engines: [{ motor: 'motor_gtin', tempoMs: 90 }] });
    const mon = new MiipMonitoringService({ telemetryService: tel });
    const analise = mon.analisar();
    assert.strictEqual(analise.tempoMedio, 150);
    assert.strictEqual(analise.totalExecucoes, 2);
    assert.ok(analise.metricas);
  });

  await test('MiipMonitoringService detecta configs válidos', () => {
    const analise = new MiipMonitoringService().analisar();
    assert.strictEqual(analise.falhasConfiguracao.length, 0);
    assert.ok([MiipHealthStatus.OK, MiipHealthStatus.WARNING].includes(analise.status));
  });

  await test('MiipDiagnosticService healthCheck retorna status', () => {
    const health = new MiipDiagnosticService().healthCheck();
    assert.ok(MiipHealthStatus.isValid(health.status));
    assert.ok(health.resumo);
  });

  await test('MiipDiagnosticService valida estrutura', () => {
    const diag = new MiipDiagnosticService().executar();
    assert.strictEqual(diag.estrutural.aprovado, true);
    assert.strictEqual(diag.configuracao.aprovado, true);
    assert.strictEqual(diag.engines.aprovado, true);
    assert.strictEqual(diag.repositories.aprovado, true);
  });

  await test('MiipDiagnosticService valida engines obrigatórios', () => {
    const diag = new MiipDiagnosticService().executar();
    assert.strictEqual(diag.engines.ausentes.length, 0);
  });

  await test('MiipDiagnosticService valida repositories', () => {
    const diag = new MiipDiagnosticService().executar();
    assert.strictEqual(diag.repositories.verificados, 2);
  });

  await test('toda execução possui requestId e tempo', () => {
    const report = criarTelemetry().registrarExecucao({
      decisao: 'AUTO_ASSOCIAR',
      tempoTotal: 55,
      scoreFinal: 100
    });
    assert.ok(report.requestId);
    assert.strictEqual(report.tempoTotal, 55);
  });

  await test('toda execução possui motores e resultado', () => {
    const report = criarTelemetry().registrarExecucao({
      engines: [{ motor: 'motor_gtin', tempoMs: 30 }],
      decisao: 'AUTO_ASSOCIAR',
      tempoTotal: 35,
      quantidadeCandidatos: 1,
      produtoSelecionado: { produtoId: 10 }
    });
    assert.ok(report.enginesExecutados.length >= 1);
    assert.ok(report.decisao);
    assert.strictEqual(report.quantidadeCandidatos, 1);
  });

  await test('logs registrados via telemetry', () => {
    const logs = new MiipMotorLogService();
    logs.reiniciar();
    const tel = new MiipTelemetryService({ logService: logs });
    tel.registrarExecucao({
      engines: [{ motor: 'motor_gtin', tempoMs: 20 }],
      tempoTotal: 25,
      decisao: 'OK'
    });
    assert.ok(logs.total() >= 2);
  });

  await test('métricas registradas via telemetry', () => {
    const metrics = new MiipMetricsCollector();
    metrics.reiniciar();
    const tel = new MiipTelemetryService({ metricsCollector: metrics });
    tel.registrarExecucao({
      engines: [{ motor: 'motor_gtin', tempoMs: 30, encontrado: true }],
      tempoTotal: 35,
      decisao: 'OK'
    });
    const resumo = metrics.obterResumo();
    assert.ok(resumo.totalConsultas >= 1);
  });

  // --- Cenários de falha ---
  await test('engine desativado gera WARNING no diagnóstico', () => {
    const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');

    class MotorTesteOff extends IMotorIdentificacao {
      getCodigo() { return 'motor_teste_off'; }
      getDescricao() { return 'teste'; }
      getPeso() { return 0; }
      async identificar() { return []; }
    }

    const registry = new MotorRegistry();
    registry.registrar({ codigo: 'motor_teste_off', Classe: MotorTesteOff, ativo: false });
    const diag = new MiipDiagnosticService({ motorRegistry: registry }).executar();
    assert.ok(diag.engines.totalDesativados >= 1);
    registry.remover('motor_teste_off');
  });

  await test('múltiplos erros consolidam health ERROR', () => {
    const tel = criarTelemetry();
    const report = tel.registrarExecucao({
      engines: [
        { motor: 'motor_a', tempoMs: 10, erro: true },
        { motor: 'motor_b', tempoMs: 20, erro: true }
      ],
      tempoTotal: 30,
      decisao: 'CADASTRAR_NOVO'
    });
    assert.strictEqual(report.health, MiipHealthStatus.ERROR);
    assert.strictEqual(report.errors.length, 2);
  });

  await test('performance tempoPorEngine agrega por motor', () => {
    const metricas = MiipPerformanceMetrics.calcular([
      { tempoTotal: 100, tempoPorEngine: { motor_gtin: 40 } },
      { tempoTotal: 120, tempoPorEngine: { motor_gtin: 60 } }
    ]);
    assert.strictEqual(metricas.tempoPorEngine.motor_gtin.totalExecucoes, 2);
    assert.strictEqual(metricas.tempoPorEngine.motor_gtin.tempoMedio, 50);
  });

  // --- Lote execuções performance ---
  const tempos = [50, 80, 120, 200, 90];
  for (let i = 0; i < tempos.length; i += 1) {
    await test(`execução performance #${i + 1} — tempo ${tempos[i]}ms`, () => {
      const tel = criarTelemetry();
      const report = tel.registrarExecucao({
        tempoTotal: tempos[i],
        engines: [{ motor: 'motor_gtin', tempoMs: tempos[i] - 10 }],
        decisao: 'MOSTRAR_SUGESTOES',
        scoreFinal: 85
      });
      assert.strictEqual(report.tempoTotal, tempos[i]);
    });
  }

  // --- Health checks ---
  const healthCenarios = ['OK', 'WARNING', 'ERROR'];
  for (let i = 0; i < healthCenarios.length; i += 1) {
    await test(`MiipHealthStatus consolidar inclui ${healthCenarios[i]} #${i + 1}`, () => {
      const lista = ['OK', 'OK', healthCenarios[i]];
      assert.strictEqual(
        MiipHealthStatus.consolidar(...lista),
        healthCenarios[i] === 'OK' ? 'OK' : healthCenarios[i]
      );
    });
  }

  await test('serviços não importam motores diretamente', () => {
    const arquivos = [
      'services/MiipTelemetryService.js',
      'services/MiipMonitoringService.js',
      'services/MiipDiagnosticService.js'
    ];
    arquivos.forEach((rel) => {
      const codigo = fs.readFileSync(
        path.join(__dirname, '../../backend/motores/miip', rel),
        'utf8'
      );
      assert.strictEqual(/require\(['"].*MotorGTIN/.test(codigo), false, rel);
      assert.strictEqual(/require\(['"].*MotorSimilarity/.test(codigo), false, rel);
      assert.strictEqual(/require\(['"].*\/engines\//.test(codigo), false, rel);
    });
  });

  await test('MiipExecutionReport toJSON serializável', () => {
    const json = JSON.parse(JSON.stringify(
      criarTelemetry().registrarExecucao({ tempoTotal: 10, decisao: 'X' }).toJSON()
    ));
    assert.ok(json.requestId);
    assert.ok(json.versao);
  });

  await test('MiipPerformanceMetrics vazio retorna zeros', () => {
    const m = MiipPerformanceMetrics.calcular([]);
    assert.strictEqual(m.totalExecucoes, 0);
    assert.strictEqual(m.tempoMedio, 0);
  });

  await test('monitoramento com motor erro via metrics', () => {
    const metrics = new MiipMetricsCollector();
    metrics.reiniciar();
    metrics.registrarExecucao({ motor: 'motor_x', duracaoMs: 10, erro: true });
    const analise = new MiipMonitoringService({ metricsCollector: metrics }).analisar();
    assert.strictEqual(analise.motoresComErro.length, 1);
    assert.strictEqual(analise.status, MiipHealthStatus.ERROR);
  });

  await test('diagnóstico completo status OK ou WARNING', () => {
    const diag = new MiipDiagnosticService().executar();
    assert.ok([MiipHealthStatus.OK, MiipHealthStatus.WARNING].includes(diag.status));
  });

  await test('telemetry reiniciar limpa histórico', () => {
    const tel = criarTelemetry();
    tel.registrarExecucao({ tempoTotal: 10, decisao: 'X' });
    tel.reiniciar();
    assert.strictEqual(tel.obterHistorico().length, 0);
  });

  await test('monitoring obterMetricas com lista externa', () => {
    const mon = new MiipMonitoringService();
    const m = mon.obterMetricas([{ tempoTotal: 100 }, { tempoTotal: 300 }]);
    assert.strictEqual(m.tempoMedio, 200);
  });

  await test('execution report sem decisão ainda serializa', () => {
    const report = MiipExecutionReport.create({
      requestId: 'x',
      tempoTotal: 0,
      errors: [{ mensagem: 'falha' }]
    });
    assert.strictEqual(report.health, MiipHealthStatus.OK);
    assert.ok(report.toJSON().errors.length === 1);
  });

  await test('telemetry produtoSelecionado e nivelConfianca', () => {
    const report = criarTelemetry().registrarExecucao({
      tempoTotal: 60,
      decisao: 'AUTO_ASSOCIAR',
      nivelConfianca: 'ALTA',
      produtoSelecionado: { produtoId: 99 },
      scoreFinal: 100
    });
    assert.strictEqual(report.nivelConfianca, 'ALTA');
    assert.strictEqual(report.produtoSelecionado.produtoId, 99);
  });

  await test('diagnostic tempo de execução registrado', () => {
    const diag = new MiipDiagnosticService().executar();
    assert.ok(diag.tempo >= 0);
    assert.ok(diag.verificadoEm);
  });

  await test('health status consolidar só OK retorna OK', () => {
    assert.strictEqual(MiipHealthStatus.consolidar('OK', 'OK', 'OK'), 'OK');
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);

  if (falhou > 0) {
    process.exit(1);
  }
}

main();
