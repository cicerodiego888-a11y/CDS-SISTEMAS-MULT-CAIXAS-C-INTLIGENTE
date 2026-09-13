/**
 * Testes — DecisionEngine (Sprint 11)
 * Executar: npm run test:miip-decision
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MiipEvidence = require('../../backend/motores/miip/core/MiipEvidence');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const MiipCandidateCollection = require('../../backend/motores/miip/core/MiipCandidateCollection');
const MiipContext = require('../../backend/motores/miip/core/MiipContext');
const SimilarityResult = require('../../backend/motores/miip/core/SimilarityResult');
const DecisionAction = require('../../backend/motores/miip/core/DecisionAction');
const DecisionRule = require('../../backend/motores/miip/core/DecisionRule');
const DecisionResult = require('../../backend/motores/miip/core/DecisionResult');
const DecisionExplanation = require('../../backend/motores/miip/core/DecisionExplanation');
const DecisionStatistics = require('../../backend/motores/miip/core/DecisionStatistics');
const DecisionHistory = require('../../backend/motores/miip/core/DecisionHistory');
const DecisionEngine = require('../../backend/motores/miip/core/DecisionEngine');
const DecisionRulesLoader = require('../../backend/motores/miip/utils/DecisionRulesLoader');

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

function criarEngine() {
  return new DecisionEngine();
}

function candidato(opcoes = {}) {
  return MiipCandidate.create({
    produtoId: opcoes.produtoId ?? 1,
    scoreTotal: opcoes.score ?? opcoes.scoreTotal ?? 0,
    confianca: opcoes.confianca ?? null,
    produto: opcoes.produto ?? { nome: opcoes.nome ?? 'Produto Teste', codigo: 'P001' },
    motoresQueVotaram: opcoes.motor ? [opcoes.motor] : (opcoes.motores ?? []),
    evidencias: (opcoes.evidencias ?? []).map((ev) => (
      ev instanceof MiipEvidence ? ev : MiipEvidence.create(ev)
    ))
  });
}

function colecao(...itens) {
  const c = new MiipCandidateCollection();
  itens.forEach((item) => c.adicionar(item));
  return c;
}

function decidir(candidatos, similarity, contexto) {
  const cols = Array.isArray(candidatos)
    ? colecao(...candidatos)
    : candidatos;
  return criarEngine().decidir(
    similarity ?? null,
    cols ?? colecao(),
    contexto ?? MiipContext.agora()
  );
}

function gtin100(produtoId = 10) {
  return candidato({
    produtoId,
    score: 100,
    motor: 'motor_gtin',
    evidencias: [{ motor: 'motor_gtin', tipo: 'gtin_exato', score: 100, valor: '7891234567890' }]
  });
}

function fornecedor100(produtoId = 20) {
  return candidato({
    produtoId,
    score: 100,
    motor: 'motor_associacao_fornecedor',
    evidencias: [{ motor: 'motor_associacao_fornecedor', tipo: 'associacao_fornecedor', score: 100 }]
  });
}

async function main() {
  console.log('\n=== Testes DecisionEngine — MIIP (Sprint 11) ===\n');

  await test('DecisionEngine não acessa SQL, XML, GTIN engine ou ERP', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/core/DecisionEngine.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const proibidos = [
      /SELECT\s+/i,
      /ProdutoRepository/i,
      /xml2js/i,
      /require\(['"]\.\.\/\.\.\/\.\.\/database/i,
      /MotorGTIN/i,
      /openai/i
    ];
    proibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão proibido: ${padrao}`);
    });
  });

  await test('DecisionAction define ações oficiais Sprint 11', () => {
    assert.ok(DecisionAction.isValid('AUTO_ASSOCIAR'));
    assert.ok(DecisionAction.isValid('SUGERIR_CONFIRMACAO'));
    assert.ok(DecisionAction.isValid('MOSTRAR_SUGESTOES'));
    assert.ok(DecisionAction.isValid('CADASTRAR_NOVO'));
    assert.strictEqual(DecisionAction.values().length, 4);
  });

  await test('DecisionRule serializa campos oficiais', () => {
    const regra = DecisionRule.create({
      nome: 'gtin_100',
      peso: 100,
      ativo: true,
      prioridade: 1,
      acao: 'AUTO_ASSOCIAR'
    });
    assert.strictEqual(regra.nome, 'gtin_100');
    assert.strictEqual(regra.peso, 100);
    assert.strictEqual(regra.ativo, true);
    assert.strictEqual(regra.prioridade, 1);
  });

  await test('DecisionResult inclui todos os campos obrigatórios', () => {
    const resultado = DecisionResult.create({
      acao: DecisionAction.AUTO_ASSOCIAR,
      nivelCerteza: 'ALTA',
      motivos: ['gtin_exato_100'],
      explicacao: { linhas: ['Produto identificado automaticamente.'] },
      produtoSelecionado: { produtoId: 1 },
      alternativas: [],
      precisaConfirmacao: false,
      precisaCadastro: false,
      score: 100
    });
    const json = resultado.toJSON();
    assert.ok(json.acao);
    assert.ok(json.explicacao.texto);
    assert.ok(json.estatisticas);
  });

  await test('DecisionExplanation monta texto com baseadoEm', () => {
    const exp = DecisionExplanation.fromLinhas(
      ['Produto identificado automaticamente.'],
      ['Código de barras.', 'Marca.']
    );
    assert.ok(exp.texto.includes('Produto identificado'));
    assert.ok(exp.texto.includes('Baseado em:'));
    assert.ok(exp.texto.includes('Código de barras.'));
  });

  await test('DecisionStatistics registra regra vencedora e tempo', () => {
    const stats = DecisionStatistics.create({
      quantidadeRegrasAvaliadas: 3,
      tempo: 5,
      regraVencedora: 'gtin_100'
    });
    assert.strictEqual(stats.regraVencedora, 'gtin_100');
    assert.strictEqual(stats.quantidadeRegrasAvaliadas, 3);
  });

  await test('DecisionHistory registra regra, score e versão', () => {
    const hist = DecisionHistory.agora({
      regra: 'gtin_100',
      score: 100,
      versaoRegra: '1.0.0',
      acao: DecisionAction.AUTO_ASSOCIAR
    });
    assert.ok(hist.data);
    assert.strictEqual(hist.versaoRegra, '1.0.0');
  });

  await test('DecisionRulesLoader carrega regras do JSON', () => {
    const config = DecisionRulesLoader.carregar();
    assert.strictEqual(config.versao, '1.0.0');
    assert.ok(config.regras.length >= 5);
    assert.strictEqual(config.thresholds.gapMinimoConfirmacao, 15);
    assert.strictEqual(config.thresholds.sugerirConfirmacao, 95);
    assert.strictEqual(config.thresholds.mostrarSugestoes, 80);
  });

  await test('GTIN 100% → AUTO_ASSOCIAR', () => {
    const resultado = decidir([gtin100()]);
    assert.strictEqual(resultado.acao, DecisionAction.AUTO_ASSOCIAR);
    assert.strictEqual(resultado.score, 100);
    assert.strictEqual(resultado.precisaConfirmacao, false);
    assert.strictEqual(resultado.precisaCadastro, false);
    assert.ok(resultado.motivos.includes('gtin_exato_100'));
  });

  await test('GTIN 100% — explicação menciona código de barras', () => {
    const resultado = decidir([gtin100()]);
    assert.ok(resultado.explicacao.texto.includes('Produto identificado automaticamente.'));
    assert.ok(resultado.explicacao.baseadoEm.includes('Código de barras.'));
  });

  await test('GTIN 100% — produtoSelecionado preenchido', () => {
    const resultado = decidir([gtin100(42)]);
    assert.strictEqual(resultado.produtoSelecionado.produtoId, 42);
  });

  await test('GTIN 100% — nivelCerteza ALTA', () => {
    const resultado = decidir([gtin100()]);
    assert.strictEqual(resultado.nivelCerteza, 'ALTA');
  });

  await test('GTIN 100% — histórico registra regra gtin_100', () => {
    const engine = criarEngine();
    engine.decidir(null, colecao(gtin100()));
    assert.strictEqual(engine.obterHistorico().length, 1);
    assert.strictEqual(engine.obterHistorico()[0].regra, 'gtin_100');
  });

  await test('Fornecedor aprendido 100% → AUTO_ASSOCIAR', () => {
    const resultado = decidir([fornecedor100()]);
    assert.strictEqual(resultado.acao, DecisionAction.AUTO_ASSOCIAR);
    assert.ok(resultado.motivos.includes('fornecedor_aprendido_100'));
    assert.ok(resultado.explicacao.baseadoEm.includes('Fornecedor.'));
  });

  await test('Fornecedor 100% — prioridade menor que GTIN quando ambos presentes', () => {
    const resultado = decidir([gtin100(1), fornecedor100(2)]);
    assert.strictEqual(resultado.acao, DecisionAction.AUTO_ASSOCIAR);
    assert.strictEqual(resultado.produtoSelecionado.produtoId, 1);
    assert.ok(resultado.motivos.includes('gtin_exato_100'));
  });

  await test('Score 100 sem GTIN nem fornecedor — não AUTO_ASSOCIAR', () => {
    const resultado = decidir([
      candidato({ produtoId: 5, score: 100, motor: 'motor_similarity' })
    ]);
    assert.notStrictEqual(resultado.acao, DecisionAction.AUTO_ASSOCIAR);
  });

  await test('Score 95% gap 15 → SUGERIR_CONFIRMACAO', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 95 }),
      candidato({ produtoId: 2, score: 80 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.SUGERIR_CONFIRMACAO);
    assert.strictEqual(resultado.precisaConfirmacao, true);
    assert.ok(resultado.motivos.includes('score_alto_gap_suficiente'));
  });

  await test('Score 96% gap 20 → SUGERIR_CONFIRMACAO', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 96 }),
      candidato({ produtoId: 2, score: 76 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.SUGERIR_CONFIRMACAO);
  });

  await test('Score 95% gap 14 → MOSTRAR_SUGESTOES (gap insuficiente)', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 95 }),
      candidato({ produtoId: 2, score: 81 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
    assert.ok(resultado.motivos.includes('score_alto_gap_insuficiente'));
  });

  await test('Score 97% empate → MOSTRAR_SUGESTOES', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 97 }),
      candidato({ produtoId: 2, score: 97 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
    assert.ok(resultado.motivos.includes('score_alto_gap_insuficiente'));
  });

  await test('Score 80% → MOSTRAR_SUGESTOES', () => {
    const resultado = decidir([candidato({ produtoId: 1, score: 80 })]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
    assert.strictEqual(resultado.precisaConfirmacao, true);
    assert.ok(resultado.motivos.includes('score_medio_sugestoes'));
  });

  await test('Score 94% → MOSTRAR_SUGESTOES', () => {
    const resultado = decidir([candidato({ produtoId: 1, score: 94 })]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
  });

  await test('Score 85% → MOSTRAR_SUGESTOES', () => {
    const resultado = decidir([candidato({ produtoId: 1, score: 85 })]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
  });

  await test('Score 79% → CADASTRAR_NOVO', () => {
    const resultado = decidir([candidato({ produtoId: 1, score: 79 })]);
    assert.strictEqual(resultado.acao, DecisionAction.CADASTRAR_NOVO);
    assert.strictEqual(resultado.precisaCadastro, true);
    assert.strictEqual(resultado.precisaConfirmacao, false);
    assert.ok(resultado.motivos.includes('score_abaixo_80'));
  });

  await test('Score 50% → CADASTRAR_NOVO', () => {
    const resultado = decidir([candidato({ produtoId: 1, score: 50 })]);
    assert.strictEqual(resultado.acao, DecisionAction.CADASTRAR_NOVO);
  });

  await test('Score 0% sem candidatos → CADASTRAR_NOVO', () => {
    const resultado = decidir([]);
    assert.strictEqual(resultado.acao, DecisionAction.CADASTRAR_NOVO);
    assert.ok(resultado.motivos.includes('nenhum_candidato_confiavel'));
    assert.strictEqual(resultado.produtoSelecionado, null);
  });

  await test('alternativas lista demais candidatos', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 85 }),
      candidato({ produtoId: 2, score: 70 }),
      candidato({ produtoId: 3, score: 60 })
    ]);
    assert.strictEqual(resultado.alternativas.length, 2);
    assert.strictEqual(resultado.alternativas[0].produtoId, 2);
  });

  await test('SimilarityResult enriquece explicação com atributos', () => {
    const similarity = SimilarityResult.create({
      score: 90,
      matchedAttributes: ['marca', 'potencia']
    });
    const resultado = decidir(
      [candidato({ produtoId: 1, score: 85 })],
      similarity
    );
    assert.ok(resultado.explicacao.baseadoEm.includes('Marca.'));
    assert.ok(resultado.explicacao.baseadoEm.includes('Potência.'));
  });

  await test('estatísticas registram regra vencedora', () => {
    const resultado = decidir([gtin100()]);
    assert.strictEqual(resultado.estatisticas.regraVencedora, 'gtin_100');
    assert.ok(resultado.estatisticas.quantidadeRegrasAvaliadas >= 1);
    assert.ok(resultado.estatisticas.tempo >= 0);
  });

  await test('obterUltimoResultado retorna última decisão', () => {
    const engine = criarEngine();
    engine.decidir(null, colecao(candidato({ score: 79 })));
    assert.strictEqual(engine.obterUltimoResultado().acao, DecisionAction.CADASTRAR_NOVO);
  });

  await test('histórico acumula múltiplas decisões', () => {
    const engine = criarEngine();
    engine.decidir(null, colecao(gtin100()));
    engine.decidir(null, colecao(candidato({ score: 85 })));
    engine.decidir(null, colecao(candidato({ score: 50 })));
    assert.strictEqual(engine.obterHistorico().length, 3);
  });

  await test('toJSON do DecisionResult é serializável', () => {
    const resultado = decidir([gtin100()]);
    const json = JSON.parse(JSON.stringify(resultado.toJSON()));
    assert.strictEqual(json.acao, DecisionAction.AUTO_ASSOCIAR);
    assert.ok(json.historico);
  });

  // --- Casos GTIN em lote ---
  for (let i = 0; i < 5; i += 1) {
    await test(`GTIN 100% caso #${i + 1} → AUTO_ASSOCIAR`, () => {
      const resultado = decidir([gtin100(100 + i)]);
      assert.strictEqual(resultado.acao, DecisionAction.AUTO_ASSOCIAR);
      assert.strictEqual(resultado.score, 100);
    });
  }

  // --- Casos Fornecedor em lote ---
  for (let i = 0; i < 5; i += 1) {
    await test(`Fornecedor 100% caso #${i + 1} → AUTO_ASSOCIAR`, () => {
      const resultado = decidir([fornecedor100(200 + i)]);
      assert.strictEqual(resultado.acao, DecisionAction.AUTO_ASSOCIAR);
    });
  }

  // --- Casos 95%+ gap grande ---
  const casos95 = [
    [95, 80], [96, 80], [98, 82], [100, 84], [97, 81]
  ];
  for (let i = 0; i < casos95.length; i += 1) {
    const [s1, s2] = casos95[i];
    await test(`Score ${s1}% gap ${s1 - s2} → SUGERIR_CONFIRMACAO #${i + 1}`, () => {
      const resultado = decidir([
        candidato({ produtoId: 1, score: s1 }),
        candidato({ produtoId: 2, score: s2 })
      ]);
      assert.strictEqual(resultado.acao, DecisionAction.SUGERIR_CONFIRMACAO);
    });
  }

  // --- Casos 80-94% ---
  const casos80 = [80, 82, 85, 88, 90, 92, 94];
  for (let i = 0; i < casos80.length; i += 1) {
    const score = casos80[i];
    await test(`Score ${score}% → MOSTRAR_SUGESTOES #${i + 1}`, () => {
      const resultado = decidir([candidato({ produtoId: 1, score })]);
      assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
    });
  }

  // --- Casos abaixo 80% ---
  const casosBaixo = [0, 10, 30, 50, 70, 79];
  for (let i = 0; i < casosBaixo.length; i += 1) {
    const score = casosBaixo[i];
    await test(`Score ${score}% → CADASTRAR_NOVO #${i + 1}`, () => {
      const resultado = decidir([candidato({ produtoId: 1, score })]);
      assert.strictEqual(resultado.acao, DecisionAction.CADASTRAR_NOVO);
    });
  }

  // --- Empates e gaps ---
  const empates = [
    [90, 90], [85, 85], [95, 95], [88, 88]
  ];
  for (let i = 0; i < empates.length; i += 1) {
    const [s1, s2] = empates[i];
    await test(`Empate ${s1}/${s2} #${i + 1}`, () => {
      const resultado = decidir([
        candidato({ produtoId: 1, score: s1 }),
        candidato({ produtoId: 2, score: s2 })
      ]);
      assert.notStrictEqual(resultado.acao, DecisionAction.SUGERIR_CONFIRMACAO);
      assert.strictEqual(resultado.precisaConfirmacao, true);
    });
  }

  await test('diferença grande 95 vs 60 → SUGERIR_CONFIRMACAO', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 95 }),
      candidato({ produtoId: 2, score: 60 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.SUGERIR_CONFIRMACAO);
  });

  await test('diferença pequena 95 vs 90 → MOSTRAR_SUGESTOES', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 95 }),
      candidato({ produtoId: 2, score: 90 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
  });

  await test('diferença pequena 96 vs 94 → MOSTRAR_SUGESTOES', () => {
    const resultado = decidir([
      candidato({ produtoId: 1, score: 96 }),
      candidato({ produtoId: 2, score: 94 })
    ]);
    assert.strictEqual(resultado.acao, DecisionAction.MOSTRAR_SUGESTOES);
  });

  await test('único candidato 96% → SUGERIR_CONFIRMACAO (gap infinito)', () => {
    const resultado = decidir([candidato({ produtoId: 1, score: 96 })]);
    assert.strictEqual(resultado.acao, DecisionAction.SUGERIR_CONFIRMACAO);
  });

  await test('contexto operacaoId propagado ao histórico', () => {
    const engine = criarEngine();
    const ctx = MiipContext.agora({ operacaoId: 'op-test-123' });
    const resultado = engine.decidir(null, colecao(gtin100()), ctx);
    assert.strictEqual(resultado.historico.operacaoId, 'op-test-123');
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);

  if (falhou > 0) {
    process.exit(1);
  }
}

main();
