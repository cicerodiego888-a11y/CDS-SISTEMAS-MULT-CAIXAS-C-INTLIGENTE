'use strict';

/**
 * MIB Sprint 01 — precisão de correspondência exata no RankingEngine.
 */

const assert = require('assert');

const {
  RankingEngine,
  LearningEngine,
  normalizarNomeBusca
} = require('../../backend/motores/mib');
const { tokenizar } = require('../../backend/motores/mib/core/tokenizer');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function item(id, nome, extra = {}) {
  return {
    id,
    nome,
    nome_busca: extra.nome_busca || normalizarNomeBusca(nome),
    codigo: extra.codigo != null ? String(extra.codigo) : String(id),
    codigo_barras: extra.codigo_barras != null ? String(extra.codigo_barras) : '',
    plu: extra.plu != null ? String(extra.plu) : '',
    categoria: extra.categoria || '',
    marca: extra.marca || '',
    item_fiscal: 1,
    preco: 10
  };
}

function ctxBusca(termo, extra = {}) {
  const tok = tokenizar(termo);
  return {
    termoRaw: termo,
    termoNorm: tok.normalizado,
    tokensNorm: tok.tokensNorm,
    tokensExpandidos: tok.tokensNorm,
    ...extra
  };
}

async function main() {
  const rank = new RankingEngine();
  const TIPO = RankingEngine.MATCH_TIPO;
  const SCORES = RankingEngine.MATCH_SCORES;

  await test('TESTE 01 — NOME EXATO', () => {
    const tipo = RankingEngine.classificarMatchNome(
      item(1, 'PICOLE CREMOSO'),
      ctxBusca('PICOLE CREMOSO')
    );
    assert.strictEqual(tipo, TIPO.NOME_EXATO);
  });

  await test('TESTE 02 — ACENTUAÇÃO equivale a EXATO', () => {
    const tipo = RankingEngine.classificarMatchNome(
      item(1, 'PICOLE CREMOSO'),
      ctxBusca('picolé cremoso')
    );
    assert.strictEqual(tipo, TIPO.NOME_EXATO);
    assert.strictEqual(
      normalizarNomeBusca('picolé cremoso'),
      normalizarNomeBusca('PICOLE CREMOSO')
    );
  });

  await test('TESTE 03 — FRASE EXATA', () => {
    const tipo = RankingEngine.classificarMatchNome(
      item(1, 'PICOLE CREMOSO CHOCOLATE'),
      ctxBusca('PICOLE CREMOSO')
    );
    assert.strictEqual(tipo, TIPO.FRASE_EXATA);
  });

  await test('TESTE 04 — TODOS OS TERMOS NO NOME', () => {
    const tipo = RankingEngine.classificarMatchNome(
      item(1, 'PICOLE DE CHOCOLATE CREMOSO'),
      ctxBusca('PICOLE CREMOSO')
    );
    assert.strictEqual(tipo, TIPO.TODOS_TERMOS_NO_NOME);
  });

  await test('hierarquia de pontuação objetiva', () => {
    assert.ok(SCORES.NOME_EXATO > SCORES.FRASE_EXATA);
    assert.ok(SCORES.FRASE_EXATA > SCORES.TODOS_TERMOS_NO_NOME);
    assert.ok(SCORES.TODOS_TERMOS_NO_NOME > SCORES.PREFIXO);
    assert.ok(SCORES.PREFIXO > SCORES.NOME_CONTEM);
  });

  await test('exemplo principal — PICOLE CREMOSO em 1º, frase em 2º', () => {
    const produtos = [
      item(1, 'PICOLE COCO - cremoso'),
      item(2, 'PICOLE MORANGO - Cremoso'),
      item(3, 'PICOLE CREMOSO'),
      item(4, 'PICOLE CREMOSO CHOCOLATE')
    ];
    const ord = rank.ordenar(produtos, ctxBusca('PICOLE CREMOSO'));
    assert.strictEqual(ord[0].nome, 'PICOLE CREMOSO');
    assert.strictEqual(ord[0].mib_match_tipo, TIPO.NOME_EXATO);
    assert.strictEqual(ord[1].nome, 'PICOLE CREMOSO CHOCOLATE');
    assert.strictEqual(ord[1].mib_match_tipo, TIPO.FRASE_EXATA);
    const resto = ord.slice(2).map((p) => p.nome);
    assert.ok(resto.includes('PICOLE COCO - cremoso'));
    assert.ok(resto.includes('PICOLE MORANGO - Cremoso'));
  });

  await test('TESTE 05 — categoria não supera nome exato', () => {
    const a = item(1, 'PICOLE CREMOSO');
    const b = item(2, 'PICOLE COCO', { categoria: 'PIC CREMOSA' });
    const ord = rank.ordenar([b, a], ctxBusca('PICOLE CREMOSO'));
    assert.strictEqual(ord[0].id, 1);
    assert.strictEqual(ord[0].mib_match_tipo, TIPO.NOME_EXATO);
    assert.ok(ord[0].mib_match_rank > ord[1].mib_match_rank);
  });

  await test('TESTE 06 — aprendizado não supera nome exato', () => {
    const learning = new LearningEngine(null, { limitePreferencia: 1 });
    const termo = 'picole cremoso';
    const termoNorm = normalizarNomeBusca(termo);
    learning._prefMem.set(`${termoNorm}|9`, new Map([[2, 20]]));
    learning.registrarSelecao(2);
    learning.registrarSelecao(2);
    learning.registrarSelecao(2);
    learning.registrarSelecao(2);
    learning.registrarSelecao(2);
    learning._favoritos.add(2);
    learning._maisVendidos.add(2);
    learning._ultimasVendas.add(2);

    const rankApr = new RankingEngine(learning);
    const a = item(1, 'PICOLE CREMOSO');
    const b = item(2, 'PICOLE COCO');
    const ord = rankApr.ordenar([b, a], ctxBusca('PICOLE CREMOSO', { operador_id: 9 }));
    assert.strictEqual(ord[0].nome, 'PICOLE CREMOSO');
    assert.ok(ord[0].mib_score > 0);
    assert.ok(ord[1].mib_score > RankingEngine.SCORES.OPERADOR, 'aprendizado ainda pontua o COCO');
  });

  await test('TESTE 07 — busca por código continua correta', () => {
    const itens = [
      item(1, 'PICOLE CREMOSO', { codigo: 'X' }),
      item(2, 'PICOLE COCO', { codigo: '100' })
    ];
    const ord = rank.ordenar(itens, '100', '100', 'codigo');
    assert.strictEqual(ord[0].id, 2);
    assert.ok(ord[0].mib_score >= 100);
    assert.strictEqual(ord[0].mib_match_rank, RankingEngine.MATCH_RANK.IDENTIFIER);
  });

  await test('TESTE 07b — EAN/GTIN continua correto', () => {
    const ean = '7891234567890';
    const itens = [
      item(1, 'PICOLE CREMOSO', { codigo: '10' }),
      item(2, 'PICOLE COCO', { codigo: '20', codigo_barras: ean })
    ];
    const ord = rank.ordenar(itens, ctxBusca(ean));
    assert.strictEqual(ord[0].id, 2);
    assert.strictEqual(ord[0].codigo_barras, ean);
    assert.strictEqual(ord[0].mib_match_rank, RankingEngine.MATCH_RANK.IDENTIFIER);
  });

  await test('fuzzy não supera nome exato', () => {
    const a = item(1, 'PICOLE CREMOSO');
    const b = {
      ...item(2, 'PICOLE COCO - cremoso'),
      _matchTipo: { fuzzy: true }
    };
    const ord = rank.ordenar([b, a], ctxBusca('PICOLE CREMOSO'));
    assert.strictEqual(ord[0].id, 1);
    assert.strictEqual(ord[0].mib_match_tipo, TIPO.NOME_EXATO);
  });

  await test('caixa/acentos equivalentes no ranking', () => {
    const produtos = [
      item(1, 'PICOLE COCO - cremoso'),
      item(2, 'Picolé Cremoso')
    ];
    const ord = rank.ordenar(produtos, ctxBusca('PICOLE CREMOSO'));
    assert.strictEqual(ord[0].id, 2);
    assert.strictEqual(ord[0].mib_match_tipo, TIPO.NOME_EXATO);
  });

  await test('todos os termos no nome acima de correspondência parcial', () => {
    const todos = item(1, 'PICOLE DE CHOCOLATE CREMOSO');
    const parcial = item(2, 'PICOLE COCO');
    const ord = rank.ordenar([parcial, todos], ctxBusca('PICOLE CREMOSO'));
    assert.strictEqual(ord[0].id, 1);
    assert.strictEqual(ord[0].mib_match_tipo, TIPO.TODOS_TERMOS_NO_NOME);
    assert.ok(ord[0].mib_match_rank > ord[1].mib_match_rank);
  });

  await test('frase exata acima de todos os termos', () => {
    const frase = item(1, 'PICOLE CREMOSO CHOCOLATE');
    const termos = item(2, 'PICOLE DE CHOCOLATE CREMOSO');
    const ord = rank.ordenar([termos, frase], ctxBusca('PICOLE CREMOSO'));
    assert.strictEqual(ord[0].id, 1);
    assert.strictEqual(ord[0].mib_match_tipo, TIPO.FRASE_EXATA);
    assert.strictEqual(ord[1].mib_match_tipo, TIPO.TODOS_TERMOS_NO_NOME);
  });

  console.log('\nMIB Sprint 01 precisão exata OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
