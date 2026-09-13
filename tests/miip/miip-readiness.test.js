/**
 * Testes — MIIP Readiness / Calibração Final (Sprint 13)
 * Executar: npm run test:miip-readiness
 * Relatório completo: npm run test:miip-readiness-full
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MiipArchitectureValidator = require('../../backend/motores/miip/audit/MiipArchitectureValidator');
const MiipDecisionValidator = require('../../backend/motores/miip/audit/MiipDecisionValidator');
const MiipHealthCheck = require('../../backend/motores/miip/audit/MiipHealthCheck');
const MiipPerformanceReport = require('../../backend/motores/miip/audit/MiipPerformanceReport');
const MiipAuditService = require('../../backend/motores/miip/audit/MiipAuditService');
const MiipDecisionBuilder = require('../../backend/motores/miip/core/MiipDecisionBuilder');
const MiipCandidateCollection = require('../../backend/motores/miip/core/MiipCandidateCollection');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const MiipEvidence = require('../../backend/motores/miip/core/MiipEvidence');

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

const MIIP_ROOT = path.join(__dirname, '../../backend/motores/miip');

async function main() {
  console.log('\n=== Testes MIIP Readiness — Sprint 13 ===\n');

  await test('MiipArchitectureValidator existe e valida', () => {
    const resultado = new MiipArchitectureValidator().validar();
    assert.strictEqual(resultado.aprovado, true, JSON.stringify(resultado.violacoes));
    assert.strictEqual(resultado.violacoes.length, 0);
  });

  await test('engines inteligência não consultam SQL direto', () => {
    const resultado = new MiipArchitectureValidator().validar();
    const sqlViolations = resultado.violacoes.filter((v) => v.tipo.includes('sql'));
    assert.strictEqual(sqlViolations.length, 0, JSON.stringify(sqlViolations));
  });

  await test('engines inteligência não tomam decisão', () => {
    const resultado = new MiipArchitectureValidator().validar();
    const decViolations = resultado.violacoes.filter((v) => v.tipo.includes('decisao'));
    assert.strictEqual(decViolations.length, 0);
  });

  await test('configs obrigatórios presentes', () => {
    const resultado = new MiipArchitectureValidator().validar();
    assert.strictEqual(resultado.configsAusentes.length, 0);
  });

  await test('MiipDecisionValidator — DecisionBuilder delega DecisionEngine', () => {
    const resultado = new MiipDecisionValidator().validar();
    assert.strictEqual(resultado.decisionEngineCentralizado, true);
    assert.strictEqual(resultado.aprovado, true, JSON.stringify(resultado.problemas));
  });

  await test('MiipExplainService presente', () => {
    const resultado = new MiipDecisionValidator().validar();
    assert.strictEqual(resultado.explainServicePresente, true);
  });

  await test('engines não retornam MiipAction', () => {
    const resultado = new MiipDecisionValidator().validar();
    const engineDecisoes = resultado.problemas.filter((p) => p.tipo === 'engine_toma_decisao');
    assert.strictEqual(engineDecisoes.length, 0);
  });

  await test('MiipHealthCheck retorna saudável', () => {
    const health = new MiipHealthCheck().executar();
    assert.strictEqual(health.saudavel, true);
    assert.strictEqual(health.versao, '1.0.0');
    assert.ok(health.modulos.decisionEngine);
    assert.ok(health.modulos.explainService);
  });

  await test('MiipHealthCheck lista 11 módulos', () => {
    const health = new MiipHealthCheck().executar();
    assert.strictEqual(health.modulosTotal, 11);
    assert.ok(health.modulosAtivos >= 10);
    assert.strictEqual(health.modulos.mubcEngine, true);
  });

  await test('MiipDecisionBuilder delega ao DecisionEngine', () => {
    const codigo = fs.readFileSync(path.join(MIIP_ROOT, 'core/MiipDecisionBuilder.js'), 'utf8');
    assert.ok(codigo.includes('DecisionEngine'));
    assert.ok(codigo.includes('MiipExplainService'));
    assert.ok(!codigo.includes('melhor.scoreTotal >= 95'));
  });

  await test('MiipDecisionBuilder retorna explicacao Miip', () => {
    const colecao = new MiipCandidateCollection();
    colecao.adicionar({
      produtoId: 1,
      scoreTotal: 100,
      motoresQueVotaram: ['motor_gtin'],
      evidencias: [MiipEvidence.create({ tipo: 'gtin_exato', score: 100, motor: 'motor_gtin' })]
    });
    const decisao = new MiipDecisionBuilder().build(colecao);
    assert.strictEqual(decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.ok(decisao.explicacao);
    assert.ok(decisao.explicacaoMiip);
    assert.ok(decisao.explicacaoMiip.titulo.length > 0);
  });

  await test('toda decisão do builder inclui explicação', () => {
    const colecao = new MiipCandidateCollection();
    colecao.adicionar({ produtoId: 2, scoreTotal: 85 });
    const decisao = new MiipDecisionBuilder().build(colecao);
    assert.ok(decisao.explicacao);
    assert.ok(decisao.explicacao.titulo || decisao.explicacaoMiip.titulo);
  });

  await test('MiipAuditService gera relatório estruturado', () => {
    const relatorio = new MiipAuditService().auditar({ executarSuites: false, salvarArquivo: false });
    assert.ok(relatorio.arquitetura);
    assert.ok(relatorio.decisao);
    assert.ok(relatorio.cobertura);
    assert.ok(relatorio.acoplamento);
    assert.ok(Array.isArray(relatorio.pendencias));
    assert.ok(Array.isArray(relatorio.riscos));
    assert.ok(Array.isArray(relatorio.recomendacoes));
  });

  await test('MiipAuditService gera markdown', () => {
    const audit = new MiipAuditService();
    const relatorio = audit.auditar({ executarSuites: false, salvarArquivo: false });
    const md = audit.gerarMarkdown(relatorio);
    assert.ok(md.includes('Arquitetura'));
    assert.ok(md.includes('Performance'));
    assert.ok(md.includes('Cobertura'));
    assert.ok(md.includes('Pendências'));
    assert.ok(md.includes('Riscos'));
    assert.ok(md.includes('Recomendações'));
  });

  await test('MiipPerformanceReport lista suítes MIIP RC1', () => {
    assert.ok(MiipPerformanceReport.SUITES_MIIP.length >= 19);
    const nomes = MiipPerformanceReport.SUITES_MIIP.map((s) => s.nome);
    assert.ok(nomes.includes('test:miip-paridade'));
    assert.ok(nomes.includes('test:miip-telemetry'));
  });

  await test('relatório salvo em docs/historico/relatorios/MIIP_READINESS_REPORT.md', () => {
    new MiipAuditService().auditar({ executarSuites: false, salvarArquivo: true });
    const reportPath = path.join(__dirname, '../../docs/historico/relatorios/MIIP_READINESS_REPORT.md');
    assert.ok(fs.existsSync(reportPath));
    const conteudo = fs.readFileSync(reportPath, 'utf8');
    assert.ok(conteudo.includes('MIIP'));
    assert.ok(conteudo.includes('Prontidão'));
  });

  // --- Validação por engine ---
  const engines = MiipArchitectureValidator.ENGINES_INTELIGENCIA;
  for (let i = 0; i < engines.length; i += 1) {
    const engine = engines[i];
    await test(`engine ${engine} sem SQL #${i + 1}`, () => {
      const conteudo = fs.readFileSync(path.join(MIIP_ROOT, engine), 'utf8');
      assert.strictEqual(/SELECT\s+/i.test(conteudo), false);
    });
  }

  // --- Componentes core obrigatórios ---
  const componentes = [
    'core/DecisionEngine.js',
    'core/MiipExplainService.js',
    'core/MiipExplanation.js',
    'core/SimilarityResult.js',
    'audit/MiipAuditService.js',
    'audit/MiipHealthCheck.js',
    'audit/MiipArchitectureValidator.js',
    'audit/MiipDecisionValidator.js',
    'audit/MiipPerformanceReport.js',
    'utils/MiipDecisionAdapter.js',
    'utils/MiipResultadoImportacaoMapper.js',
    'utils/MiipDecisaoPersistencia.js'
  ];

  for (let i = 0; i < componentes.length; i += 1) {
    const comp = componentes[i];
    await test(`componente ${comp} existe #${i + 1}`, () => {
      assert.ok(fs.existsSync(path.join(MIIP_ROOT, comp)));
    });
  }

  // --- Documentação ---
  const docs = [
    'motores/miip/MIIP_CANONICAL_ENGINE.md',
    'motores/miip/MIIP_ATTRIBUTE_ENGINE.md',
    'motores/miip/MIIP_SYNONYM_ENGINE.md',
    'motores/miip/MIIP_SIMILARITY_ENGINE.md',
    'motores/miip/MIIP_DECISION_ENGINE.md',
    'motores/miip/MIIP_EXPLAIN.md',
    'arquitetura/ARQUITETURA_MIIP.md'
  ];

  for (let i = 0; i < docs.length; i += 1) {
    await test(`documentação ${docs[i]} existe #${i + 1}`, () => {
      assert.ok(fs.existsSync(path.join(__dirname, '../../docs', docs[i])));
    });
  }

  await test('importação XML unificada ao DecisionEngine (RC1)', () => {
    const importacao = fs.readFileSync(path.join(MIIP_ROOT, 'services/MiipImportacaoXmlService.js'), 'utf8');
    assert.strictEqual(importacao.includes('_classificar'), false);
    assert.ok(importacao.includes('mapearDecisaoPipelineParaImportacao'));
    const resultado = new MiipDecisionValidator().validar();
    const problema = resultado.problemas.find((p) => p.tipo === 'classificacao_duplicada_importacao_xml');
    assert.strictEqual(problema, undefined);
  });

  await test('MiipAuditService declara prontidão quando saudável', () => {
    const relatorio = new MiipAuditService().auditar({ executarSuites: false, salvarArquivo: false });
    assert.strictEqual(relatorio.prontoProducao, true);
    assert.ok(relatorio.declaracao.includes('PRONTO'));
  });

  await test('adapter mapeia AUTO_ASSOCIAR para AUTO_VINCULAR', () => {
    const { MAPEAMENTO_ACAO } = require('../../backend/motores/miip/utils/MiipDecisionAdapter');
    const DecisionAction = require('../../backend/motores/miip/core/DecisionAction');
    assert.strictEqual(MAPEAMENTO_ACAO[DecisionAction.AUTO_ASSOCIAR], MiipAction.AUTO_VINCULAR);
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---`);
  console.log('--- Para auditoria completa com todas as suítes: npm run test:miip-readiness-full ---\n');

  if (falhou > 0) {
    process.exit(1);
  }
}

main();
