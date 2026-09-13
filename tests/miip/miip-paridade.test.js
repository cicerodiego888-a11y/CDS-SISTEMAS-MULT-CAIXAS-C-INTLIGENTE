/**
 * Testes — Paridade de decisão MIIP (Sprint RC1)
 * Executar: npm run test:miip-paridade
 */

const assert = require('assert');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const MiipCandidateCollection = require('../../backend/motores/miip/core/MiipCandidateCollection');
const MiipDecisionBuilder = require('../../backend/motores/miip/core/MiipDecisionBuilder');
const { mapearDecisaoPipelineParaImportacao } = require('../../backend/motores/miip/utils/MiipResultadoImportacaoMapper');
const utils = require('../../backend/motores/miip/utils/miipCentralRevisaoUtils');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

function criarCandidato(opcoes = {}) {
  return {
    produtoId: opcoes.produtoId ?? 10,
    produto: {
      id: opcoes.produtoId ?? 10,
      nome: opcoes.nome ?? 'Produto Teste',
      codigo: opcoes.codigo ?? 'P10',
      codigoBarras: opcoes.codigoBarras ?? '7891111111111'
    },
    nome: opcoes.nome ?? 'Produto Teste',
    codigo: opcoes.codigo ?? 'P10',
    scoreTotal: opcoes.score ?? 100,
    scorePonderado: opcoes.score ?? 100,
    motorOrigem: opcoes.motor ?? 'motor_gtin',
    motoresQueVotaram: [opcoes.motor ?? 'motor_gtin'],
    evidencias: opcoes.evidencias ?? [{ tipo: 'gtin_exato', score: 100 }]
  };
}

function decidir(candidatos, opcoes = {}) {
  const colecao = new MiipCandidateCollection();
  colecao.adicionarVarios(candidatos);
  const builder = new MiipDecisionBuilder();
  const produtosPorMotor = opcoes.produtosPorMotor
    ?? (candidatos.length > 0 ? [candidatos[0].produtoId] : []);
  return builder.build(colecao, {
    enginesExecutados: opcoes.engines ?? ['motor_gtin'],
    produtosPorMotor
  });
}

function pipelineParaImportacao(decisao, candidatos, requestId = 'req-paridade') {
  const melhor = candidatos[0] ?? null;
  const miipResp = {
    encontrado: melhor != null,
    produtoId: melhor?.produtoId ?? null
  };
  const resultado = {
    decisao,
    candidatos,
    score: { valor: decisao.score ?? melhor?.scoreTotal ?? 0 },
    requestId
  };
  return mapearDecisaoPipelineParaImportacao(miipResp, resultado);
}

async function main() {
  console.log('\n=== Testes Paridade MIIP — Sprint RC1 ===\n');

  await test('GTIN 100% — Pipeline e Importação XML concordam (auto_vincular)', () => {
    const candidatos = [criarCandidato({ score: 100, motor: 'motor_gtin' })];
    const decisao = decidir(candidatos);
    const importacao = pipelineParaImportacao(decisao, candidatos);

    assert.strictEqual(decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.strictEqual(importacao.acao, MiipAction.AUTO_VINCULAR);
    assert.strictEqual(importacao.associadoAutomaticamente, true);
    assert.strictEqual(importacao.precisaConfirmacao, false);
  });

  await test('Score 96 gap 20 — Pipeline e Importação concordam (sugerir)', () => {
    const candidatos = [
      criarCandidato({ produtoId: 1, score: 96 }),
      criarCandidato({ produtoId: 2, score: 76 })
    ];
    const decisao = decidir(candidatos);
    const importacao = pipelineParaImportacao(decisao, candidatos);

    assert.strictEqual(decisao.acao, MiipAction.SUGERIR);
    assert.strictEqual(importacao.acao, MiipAction.SUGERIR);
    assert.strictEqual(importacao.precisaConfirmacao, true);
    assert.ok(decisao.motivos.includes('score_alto_gap_suficiente'));
    assert.ok(importacao.motivos.includes('score_alto_gap_suficiente'));
  });

  await test('Score 96 gap 10 — Pipeline e Importação concordam (mostrar sugestões)', () => {
    const candidatos = [
      criarCandidato({ produtoId: 1, score: 96 }),
      criarCandidato({ produtoId: 2, score: 86 })
    ];
    const decisao = decidir(candidatos);
    const importacao = pipelineParaImportacao(decisao, candidatos);

    assert.strictEqual(decisao.acao, MiipAction.SUGERIR);
    assert.strictEqual(importacao.acao, MiipAction.SUGERIR);
    assert.strictEqual(importacao.precisaConfirmacao, true);
    assert.ok(decisao.motivos.includes('score_alto_gap_insuficiente'));
  });

  await test('Sem candidatos — Pipeline e Importação concordam (criar_novo)', () => {
    const decisao = decidir([]);
    const importacao = pipelineParaImportacao(decisao, []);

    assert.strictEqual(decisao.acao, MiipAction.CRIAR_NOVO);
    assert.strictEqual(importacao.acao, MiipAction.CRIAR_NOVO);
    assert.strictEqual(importacao.precisaCadastro, true);
  });

  await test('Central de Revisão reflete flags da Importação XML', () => {
    const candidatos = [criarCandidato({ produtoId: 5, score: 88 })];
    const decisao = decidir(candidatos);
    const importacao = pipelineParaImportacao(decisao, candidatos);

    const resultadoXml = {
      indice: 0,
      produtoXML: { produto_nome: 'Item teste' },
      produtoEncontrado: importacao.produtoEncontrado,
      score: importacao.score,
      precisaConfirmacao: importacao.precisaConfirmacao,
      precisaCadastro: importacao.precisaCadastro,
      motor: importacao.motor,
      candidatoSelecionado: importacao.candidatoSelecionado
    };

    const pendencias = utils.extrairPendencias([resultadoXml]);
    assert.strictEqual(pendencias.length, 1);
    assert.strictEqual(pendencias[0].precisaConfirmacao, importacao.precisaConfirmacao);
    assert.strictEqual(pendencias[0].precisaCadastro, importacao.precisaCadastro);
  });

  console.log(`\n${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
