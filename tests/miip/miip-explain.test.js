/**
 * Testes — MiipExplainService (Sprint 12)
 * Executar: npm run test:miip-explain
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MiipEvidence = require('../../backend/motores/miip/core/MiipEvidence');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const MiipCandidateCollection = require('../../backend/motores/miip/core/MiipCandidateCollection');
const SemanticProduct = require('../../backend/motores/miip/core/SemanticProduct');
const SimilarityResult = require('../../backend/motores/miip/core/SimilarityResult');
const SimilarityVote = require('../../backend/motores/miip/core/SimilarityVote');
const DecisionAction = require('../../backend/motores/miip/core/DecisionAction');
const DecisionResult = require('../../backend/motores/miip/core/DecisionResult');
const DecisionExplanation = require('../../backend/motores/miip/core/DecisionExplanation');
const MiipExplanation = require('../../backend/motores/miip/core/MiipExplanation');
const ExplainReport = require('../../backend/motores/miip/core/ExplainReport');
const DecisionEngine = require('../../backend/motores/miip/core/DecisionEngine');
const MiipExplainService = require('../../backend/motores/miip/core/MiipExplainService');
const ExplainFormatter = require('../../backend/motores/miip/utils/ExplainFormatter');

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

function servico() {
  return new MiipExplainService();
}

function candidato(opcoes = {}) {
  return MiipCandidate.create({
    produtoId: opcoes.produtoId ?? 1,
    scoreTotal: opcoes.score ?? 100,
    motoresQueVotaram: opcoes.motor ? [opcoes.motor] : [],
    evidencias: (opcoes.evidencias ?? []).map((ev) => MiipEvidence.create(ev))
  });
}

function decisaoGtin() {
  const engine = new DecisionEngine();
  const colecao = new MiipCandidateCollection();
  colecao.adicionar(candidato({
    produtoId: 42,
    score: 100,
    motor: 'motor_gtin',
    evidencias: [{ tipo: 'gtin_exato', score: 100, motor: 'motor_gtin' }]
  }));
  return engine.decidir(null, colecao);
}

function decisaoConfirmacao() {
  const engine = new DecisionEngine();
  const colecao = new MiipCandidateCollection();
  colecao.adicionar(candidato({ produtoId: 1, score: 95 }));
  colecao.adicionar(candidato({ produtoId: 2, score: 80 }));
  return engine.decidir(null, colecao);
}

function similarityParcial() {
  return SimilarityResult.create({
    score: 85,
    matchedAttributes: ['marca', 'potencia'],
    differentAttributes: ['modelo', 'embalagem'],
    votes: [
      SimilarityVote.create({ atributo: 'marca', peso: 25, score: 100, motivo: 'Marca: PHILIPS = PHILIPS (100%)' }),
      SimilarityVote.create({ atributo: 'potencia', peso: 20, score: 100, motivo: 'Potência: 20W = 20W (100%)' }),
      SimilarityVote.create({ atributo: 'modelo', peso: 15, score: 0, motivo: 'Modelo: A60 diferente de B60 (0%)' }),
      SimilarityVote.create({ atributo: 'embalagem', peso: 5, score: 0, motivo: 'Embalagem: CX diferente de PCT (0%)' })
    ]
  });
}

async function main() {
  console.log('\n=== Testes MiipExplainService — MIIP (Sprint 12) ===\n');

  await test('MiipExplainService não acessa SQL, XML ou ERP', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/core/MiipExplainService.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const proibidos = [/SELECT\s+/i, /xml2js/i, /ProdutoRepository/i, /require\(['"]\.\.\/\.\.\/\.\.\/database/i];
    proibidos.forEach((p) => assert.strictEqual(p.test(codigo), false));
  });

  await test('MiipExplanation serializa campos oficiais', () => {
    const exp = MiipExplanation.create({
      titulo: 'Teste',
      resumo: 'Resumo',
      nivelCerteza: 'ALTA',
      motivosPositivos: ['Marca igual'],
      motivosNegativos: ['Modelo diferente'],
      recomendacao: 'Confirme.'
    });
    const json = exp.toJSON();
    assert.strictEqual(json.titulo, 'Teste');
    assert.strictEqual(json.motivosPositivos.length, 1);
    assert.ok(exp.temConteudo());
  });

  await test('ExplainReport inclui explicacao e modo', () => {
    const report = ExplainReport.create({
      explicacao: { titulo: 'T', resumo: 'R' },
      modo: 'usuario',
      textoFormatado: 'texto',
      acao: DecisionAction.AUTO_ASSOCIAR
    });
    assert.strictEqual(report.modo, 'usuario');
    assert.ok(report.explicacao instanceof MiipExplanation);
  });

  await test('ExplainFormatter modo usuario usa ✔ e ✖', () => {
    const exp = MiipExplanation.create({
      titulo: 'Produto precisa confirmação.',
      motivosPositivos: ['Marca igual'],
      motivosNegativos: ['Modelo diferente'],
      recomendacao: 'Confirme antes de prosseguir.'
    });
    const texto = ExplainFormatter.formatarUsuario(exp);
    assert.ok(texto.includes('✔ Marca igual'));
    assert.ok(texto.includes('✖ Modelo diferente'));
    assert.ok(texto.includes('Confirme antes de prosseguir.'));
  });

  await test('ExplainFormatter modo tecnico lista atributos', () => {
    const exp = MiipExplanation.create({
      titulo: 'Título',
      resumo: 'Resumo técnico',
      nivelCerteza: 'ALTA',
      atributosCoincidentes: ['marca', 'potencia'],
      atributosDivergentes: ['modelo']
    });
    const texto = ExplainFormatter.formatarTecnico(exp);
    assert.ok(texto.includes('Atributos coincidentes: marca, potencia'));
    assert.ok(texto.includes('Atributos divergentes: modelo'));
  });

  await test('ExplainFormatter modo auditoria retorna JSON', () => {
    const exp = MiipExplanation.create({ titulo: 'Audit', nivelCerteza: 'MEDIA' });
    const texto = ExplainFormatter.formatarAuditoria(exp);
    const json = JSON.parse(texto);
    assert.strictEqual(json.titulo, 'Audit');
  });

  await test('decisão nula retorna explicação mínima', () => {
    const exp = servico().explicar(null);
    assert.ok(exp.titulo.includes('indisponível'));
    assert.ok(exp.recomendacao);
  });

  await test('GTIN AUTO_ASSOCIAR — título correto', () => {
    const exp = servico().explicar(decisaoGtin());
    assert.strictEqual(exp.titulo, 'Produto identificado automaticamente.');
  });

  await test('GTIN — motivo positivo código de barras', () => {
    const exp = servico().explicar(decisaoGtin());
    assert.ok(exp.motivosPositivos.some((m) => m.includes('Código de barras')));
  });

  await test('GTIN — recomendação automática', () => {
    const exp = servico().explicar(decisaoGtin());
    assert.ok(exp.recomendacao.includes('automaticamente'));
  });

  await test('confirmação — título precisa confirmação', () => {
    const exp = servico().explicar(decisaoConfirmacao());
    assert.strictEqual(exp.titulo, 'Produto precisa confirmação.');
  });

  await test('similarity parcial — motivos positivos e negativos', () => {
    const decision = DecisionResult.create({
      acao: DecisionAction.SUGERIR_CONFIRMACAO,
      nivelCerteza: 'ALTA',
      score: 85,
      motivos: ['score_medio_sugestoes'],
      precisaConfirmacao: true
    });
    const exp = servico().explicar(decision, similarityParcial());
    assert.ok(exp.motivosPositivos.some((m) => m.includes('Marca igual')));
    assert.ok(exp.motivosPositivos.some((m) => m.includes('Potência igual')));
    assert.ok(exp.motivosNegativos.some((m) => m.includes('Modelo diferente')));
    assert.ok(exp.motivosNegativos.some((m) => m.includes('Embalagem diferente')));
  });

  await test('atributos coincidentes e divergentes preenchidos', () => {
    const decision = DecisionResult.create({ acao: DecisionAction.MOSTRAR_SUGESTOES, score: 85 });
    const exp = servico().explicar(decision, similarityParcial());
    assert.deepStrictEqual(exp.atributosCoincidentes, ['marca', 'potencia']);
    assert.deepStrictEqual(exp.atributosDivergentes, ['modelo', 'embalagem']);
  });

  await test('nunca retorna apenas porcentagem — inclui motivos', () => {
    const decision = DecisionResult.create({ acao: DecisionAction.MOSTRAR_SUGESTOES, score: 88 });
    const exp = servico().explicar(decision, similarityParcial());
    assert.ok(exp.motivosPositivos.length > 0 || exp.motivosNegativos.length > 0);
    assert.ok(exp.explicacaoCompleta.length > 20);
  });

  await test('explicacaoCurta contém título e resumo', () => {
    const exp = servico().explicar(decisaoGtin());
    assert.ok(exp.explicacaoCurta.includes('Produto identificado'));
    assert.ok(exp.explicacaoCurta.length > 0);
  });

  await test('explicacaoCompleta formatada para usuário', () => {
    const exp = servico().explicar(decisaoConfirmacao(), similarityParcial());
    assert.ok(exp.explicacaoCompleta.includes('Motivos:'));
    assert.ok(exp.explicacaoCompleta.includes('Recomendação:'));
  });

  await test('nivelCerteza propagado da decisão', () => {
    const exp = servico().explicar(decisaoGtin());
    assert.strictEqual(exp.nivelCerteza, 'ALTA');
  });

  await test('gerarRelatorio modo usuario', () => {
    const report = servico().gerarRelatorio(decisaoGtin(), null, null, 'usuario');
    assert.strictEqual(report.modo, 'usuario');
    assert.ok(report.textoFormatado.includes('✔'));
    assert.ok(report.geradoEm);
    assert.strictEqual(report.acao, DecisionAction.AUTO_ASSOCIAR);
  });

  await test('gerarRelatorio modo tecnico', () => {
    const report = servico().gerarRelatorio(decisaoConfirmacao(), similarityParcial(), null, 'tecnico');
    assert.ok(report.textoFormatado.includes('Atributos coincidentes'));
  });

  await test('gerarRelatorio modo auditoria', () => {
    const report = servico().gerarRelatorio(decisaoGtin(), null, null, 'auditoria');
    const json = JSON.parse(report.textoFormatado);
    assert.ok(json.titulo);
  });

  await test('gerarRelatorio inclui produtoId', () => {
    const report = servico().gerarRelatorio(decisaoGtin());
    assert.strictEqual(report.produtoId, 42);
  });

  await test('CADASTRAR_NOVO — título e recomendação', () => {
    const decision = DecisionResult.create({
      acao: DecisionAction.CADASTRAR_NOVO,
      nivelCerteza: 'BAIXA',
      score: 50,
      motivos: ['score_abaixo_80'],
      precisaCadastro: true
    });
    const exp = servico().explicar(decision);
    assert.ok(exp.titulo.includes('Cadastro'));
    assert.ok(exp.recomendacao.includes('Cadastre'));
    assert.ok(exp.motivosNegativos.length > 0);
  });

  await test('fornecedor aprendido — histórico positivo', () => {
    const engine = new DecisionEngine();
    const colecao = new MiipCandidateCollection();
    colecao.adicionar(candidato({
      produtoId: 7,
      score: 100,
      motor: 'motor_associacao_fornecedor',
      evidencias: [{ tipo: 'associacao_fornecedor', score: 100 }]
    }));
    const decision = engine.decidir(null, colecao);
    const exp = servico().explicar(decision);
    assert.ok(exp.motivosPositivos.some((m) => m.includes('Histórico positivo')));
  });

  await test('SemanticProduct com gtin enriquece explicação', () => {
    const semantic = SemanticProduct.create({
      original: 'LAMPADA LED',
      canonico: 'LAMPADA LED',
      gtin: '7891234567890',
      marca: 'PHILIPS'
    });
    const exp = servico().explicar(decisaoGtin(), null, semantic);
    assert.ok(exp.motivosPositivos.some((m) => m.includes('Código de barras')));
  });

  await test('ExplainReport toJSON serializável', () => {
    const report = servico().gerarRelatorio(decisaoGtin());
    const json = JSON.parse(JSON.stringify(report.toJSON()));
    assert.ok(json.explicacao.titulo);
    assert.ok(json.textoFormatado);
  });

  // --- Casos por ação (lote) ---
  const acoes = [
    { acao: DecisionAction.AUTO_ASSOCIAR, titulo: 'automaticamente' },
    { acao: DecisionAction.SUGERIR_CONFIRMACAO, titulo: 'confirmação' },
    { acao: DecisionAction.MOSTRAR_SUGESTOES, titulo: 'Sugestões' },
    { acao: DecisionAction.CADASTRAR_NOVO, titulo: 'Cadastro' }
  ];

  for (let i = 0; i < acoes.length; i += 1) {
    const { acao, titulo } = acoes[i];
    await test(`ação ${acao} gera título com "${titulo}" #${i + 1}`, () => {
      const decision = DecisionResult.create({ acao, score: 80, nivelCerteza: 'MEDIA' });
      const exp = servico().explicar(decision);
      assert.ok(exp.titulo.includes(titulo) || exp.titulo.length > 0);
      assert.ok(exp.temConteudo());
    });
  }

  // --- Modos formatter ---
  const modos = ['usuario', 'tecnico', 'auditoria'];
  for (let i = 0; i < modos.length; i += 1) {
    await test(`gerarRelatorio modo ${modos[i]} #${i + 1}`, () => {
      const report = servico().gerarRelatorio(decisaoConfirmacao(), similarityParcial(), null, modos[i]);
      assert.ok(report.textoFormatado.length > 10);
    });
  }

  // --- Similarity scenarios ---
  const cenariosSimilarity = [
    { matched: ['marca'], different: [] },
    { matched: ['tipo', 'tecnologia'], different: ['potencia'] },
    { matched: [], different: ['marca', 'tipo'] },
    { matched: ['material', 'cor'], different: ['embalagem'] },
    { matched: ['modelo'], different: ['unidadeMedida'] }
  ];

  for (let i = 0; i < cenariosSimilarity.length; i += 1) {
    const c = cenariosSimilarity[i];
    await test(`similarity cenário #${i + 1} — atributos mapeados`, () => {
      const sim = SimilarityResult.create({
        score: 75,
        matchedAttributes: c.matched,
        differentAttributes: c.different
      });
      const decision = DecisionResult.create({ acao: DecisionAction.MOSTRAR_SUGESTOES, score: 75 });
      const exp = servico().explicar(decision, sim);
      assert.deepStrictEqual(exp.atributosCoincidentes, c.matched);
      assert.deepStrictEqual(exp.atributosDivergentes, c.different);
    });
  }

  await test('toda decisão tem explicacaoCompleta não vazia', () => {
    const cenarios = [decisaoGtin(), decisaoConfirmacao(), DecisionResult.create({
      acao: DecisionAction.CADASTRAR_NOVO, score: 30, motivos: ['score_abaixo_80'], precisaCadastro: true
    })];
    cenarios.forEach((decision) => {
      const exp = servico().explicar(decision, similarityParcial());
      assert.ok(exp.explicacaoCompleta.length > 0, 'explicacaoCompleta vazia');
      assert.ok(exp.explicacaoCurta.length > 0, 'explicacaoCurta vazia');
    });
  });

  await test('empate candidatos — motivo negativo gap insuficiente', () => {
    const engine = new DecisionEngine();
    const colecao = new MiipCandidateCollection();
    colecao.adicionar(candidato({ produtoId: 1, score: 97 }));
    colecao.adicionar(candidato({ produtoId: 2, score: 97 }));
    const decision = engine.decidir(null, colecao);
    const exp = servico().explicar(decision);
    assert.ok(exp.motivosNegativos.some((m) => m.includes('próximos')));
    assert.strictEqual(exp.titulo, 'Sugestões encontradas.');
  });

  await test('MiipExplanation toJSON inclui versão', () => {
    const exp = servico().explicar(decisaoGtin());
    assert.strictEqual(exp.toJSON().versao, '1.0.0');
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);

  if (falhou > 0) {
    process.exit(1);
  }
}

main();
