/**
 * RC3.4.6 — Health Monitor da Central de Entradas
 * Executar: node tests/central-entradas/rc346-health-monitor.test.js
 */

const assert = require('assert');
const { HealthNiveis } = require('../../backend/motores/central-entradas/health/HealthNiveis');
const { avaliarDocumento, consolidar } = require('../../backend/motores/central-entradas/health/HealthRules');
const HealthAnalyzer = require('../../backend/motores/central-entradas/health/HealthAnalyzer');
const HealthMonitor = require('../../backend/motores/central-entradas/health/HealthMonitor');
const { TIPOS_HEALTH } = require('../../backend/motores/central-entradas/health/HealthNotifier');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

const AGORA = Date.parse('2026-07-28T12:00:00.000Z');

function doc(patch = {}) {
  return {
    id: 1,
    chave: '1'.padStart(44, '2'),
    fornecedor: 'TESTE',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: 'RES_NFE',
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: '2026-07-28T08:00:00.000Z',
    temParse: false,
    temMiip: false,
    xmlCompletoProvavel: false,
    ...patch
  };
}

function testSaudavel() {
  const alertas = avaliarDocumento(
    doc({
      status: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      temParse: true,
      temMiip: true,
      updatedAt: '2026-07-28T11:50:00.000Z'
    }),
    {},
    { agora: AGORA }
  );
  assert.strictEqual(consolidar(alertas).nivel, HealthNiveis.SAUDAVEL);
}

function testAgendadoAlem() {
  const alertas = avaliarDocumento(
    doc({ updatedAt: '2026-07-28T06:00:00.000Z' }),
    {
      estadoMirx: 'AGUARDANDO_JANELA_SEFAZ',
      iniciadoEm: '2026-07-28T06:00:00.000Z',
      proximaTentativa: '2026-07-28T11:00:00.000Z'
    },
    { agora: AGORA }
  );
  const c = consolidar(alertas);
  assert.ok(alertas.some((a) => a.regra === 'AGENDADO_ALEM'));
  assert.ok([HealthNiveis.ATENCAO, HealthNiveis.CRITICO].includes(c.nivel));
}

function testSleepAlem() {
  const alertas = avaliarDocumento(
    doc(),
    {
      dormindo: true,
      estadoMirx: 'SLEEP',
      dormindoDesde: '2026-07-28T08:00:00.000Z',
      proximaTentativa: '2026-07-28T11:30:00.000Z'
    },
    { agora: AGORA }
  );
  assert.ok(alertas.some((a) => a.regra === 'SEM_WAKEUP' || a.regra === 'SLEEP_ALEM'));
}

function testSemWakeup() {
  const alertas = avaliarDocumento(
    doc(),
    {
      dormindo: true,
      estadoMirx: 'SLEEP',
      dormindoDesde: '2026-07-28T08:00:00.000Z',
      proximaTentativa: '2026-07-28T11:00:00.000Z'
    },
    { agora: AGORA }
  );
  assert.ok(alertas.some((a) => a.regra === 'SEM_WAKEUP'));
  assert.strictEqual(consolidar(alertas).nivel, HealthNiveis.CRITICO);
}

function testSemParser() {
  const alertas = avaliarDocumento(
    doc({
      status: DocumentoFiscalStatus.SINCRONIZADA,
      tipoDocumento: 'PROC_NFE',
      xmlCompletoProvavel: true,
      updatedAt: '2026-07-28T10:00:00.000Z'
    }),
    {},
    { agora: AGORA }
  );
  assert.ok(alertas.some((a) => a.regra === 'SEM_PARSER'));
  assert.strictEqual(alertas.find((a) => a.regra === 'SEM_PARSER').autoRecuperavel, true);
}

function testSemCompra() {
  const alertas = avaliarDocumento(
    doc({
      status: DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      temParse: true,
      temMiip: true,
      updatedAt: '2026-07-27T12:00:00.000Z'
    }),
    {},
    { agora: AGORA }
  );
  assert.ok(alertas.some((a) => a.regra === 'MIIP_SEM_COMPRA' || a.regra === 'SEM_COMPRA'));
}

function testXmlStatusAntigo() {
  const alertas = avaliarDocumento(
    doc({
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: 'PROC_NFE',
      xmlCompletoProvavel: true
    }),
    {},
    { agora: AGORA }
  );
  assert.ok(alertas.some((a) => a.regra === 'XML_STATUS_ANTIGO'));
}

function testResolvido() {
  const analyzer = new HealthAnalyzer({
    obterMirx: () => ({
      obterEstadoDocumento() { return null; },
      obterTelemetria() { return {}; }
    }),
    agora: () => AGORA
  });
  const d = doc({
    status: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
    temParse: true,
    temMiip: true,
    updatedAt: '2026-07-28T11:55:00.000Z'
  });
  const av = analyzer.analisarUm(d, null, { nivel: HealthNiveis.ATENCAO });
  assert.strictEqual(av.nivel, HealthNiveis.RESOLVIDO);
}

async function testMonitorScanMock() {
  const docs = [
    doc({ id: 10, updatedAt: '2026-07-28T11:50:00.000Z', status: DocumentoFiscalStatus.AGUARDANDO_REVISAO, temParse: true, temMiip: true }),
    doc({
      id: 11,
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      updatedAt: '2026-07-28T06:00:00.000Z'
    })
  ];
  const repo = {
    async listarDocumentosParaAnalise() { return docs; },
    async obterEstatisticasFluxo() {
      return {
        tempoMedioAteXmlMin: 40,
        tempoMedioAteCompraMin: 90,
        tempoMedioMiipMin: 12,
        recuperadosAutomaticamente: 3,
        recuperadosManualmente: 1,
        totalDocumentos: 2
      };
    },
    async carregarEstado() { return null; },
    async salvarEstado() { return true; }
  };
  const waits = {
    11: {
      estadoMirx: 'AGUARDANDO_JANELA_SEFAZ',
      iniciadoEm: '2026-07-28T06:00:00.000Z',
      proximaTentativa: '2026-07-28T11:00:00.000Z'
    }
  };
  const monitor = new HealthMonitor({
    repository: repo,
    obterMirx: () => ({
      obterEstadoDocumento(id) { return waits[id] || null; },
      obterTelemetria() { return { documentosRecuperados: 2, numeroTentativas: 4 }; }
    }),
    obterOrchestrator: () => ({
      async processarDocumentosPendentes() { return []; }
    }),
    agora: () => AGORA
  });
  // Inject agora into analyzer
  monitor._analyzer._agora = () => AGORA;

  const painel = await monitor.executarScan({ autoRecuperar: false });
  assert.ok(painel.contadores.saudaveis >= 1);
  assert.ok(painel.contadores.atencao + painel.contadores.criticos >= 1);
  assert.strictEqual(painel.sefazConsultada, false);
  assert.ok(painel.estatisticas.tempoMedioAteXmlMin === 40);
  assert.ok(TIPOS_HEALTH.HEALTH_WARNING);
}

function testDiagnosticoLinguagem() {
  const alertas = avaliarDocumento(
    doc({ updatedAt: '2026-07-28T06:00:00.000Z' }),
    { estadoMirx: 'AGUARDANDO_JANELA_SEFAZ', iniciadoEm: '2026-07-28T06:00:00.000Z' },
    { agora: AGORA }
  );
  const d = consolidar(alertas).alertaPrincipal?.diagnostico || '';
  assert.match(d, /recuperação automática|aguardando/i);
  assert.doesNotMatch(d, /cStat undefined/i);
}

async function main() {
  console.log('\n=== RC3.4.6 — Health Monitor ===\n');
  testSaudavel();
  console.log('✓ Documento saudável');
  testAgendadoAlem();
  console.log('✓ Documento em AGENDADO além do esperado');
  testSleepAlem();
  console.log('✓ Documento em SLEEP');
  testSemWakeup();
  console.log('✓ Documento sem WAKEUP');
  testSemParser();
  console.log('✓ Documento sem Parser');
  testSemCompra();
  console.log('✓ Documento sem Compra');
  testXmlStatusAntigo();
  console.log('✓ Documento com XML salvo e status antigo');
  testResolvido();
  console.log('✓ Alerta resolvido automaticamente');
  await testMonitorScanMock();
  console.log('✓ Scan + dashboard stats (sem SEFAZ)');
  testDiagnosticoLinguagem();
  console.log('✓ Diagnóstico em linguagem simples');
  console.log('\nRC3.4.6 OK\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
