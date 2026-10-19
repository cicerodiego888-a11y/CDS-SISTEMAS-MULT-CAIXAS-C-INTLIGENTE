'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { gerarPreviaDistribuicao } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');
const { gerarPreviaPorComprovante } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');
const { listarLotesElegiveisDoDia } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalElegibilidadeService');

function lote({
  produtoId,
  saldoFiscal,
  quantidade = 1,
  preco,
  itemId = produtoId,
  produtoNome = `Produto ${produtoId}`
}) {
  return {
    produto_id: produtoId,
    saldo_fiscal: saldoFiscal,
    nome: produtoNome,
    venda_id: produtoId,
    venda_item_id: itemId,
    unidade: 'UN',
    fracionado: false,
    quantidade_disponivel: quantidade,
    valor_disponivel: quantidade * preco,
    preco_unitario: preco,
    unit_cents: Math.round(preco * 100)
  };
}

function previa(lotes, valorInformado, limites = {}) {
  return gerarPreviaDistribuicao(lotes, valorInformado, {
    valorAlvo: valorInformado,
    valorMin: 1,
    valorMax: 100,
    distribuicaoRealista: false,
    ...limites
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => (error ? reject(error) : resolve()));
  });
}

test('seleciona a maior prioridade fiscal antes de alternativas monetariamente equivalentes', () => {
  const result = previa([
    lote({ produtoId: 4, saldoFiscal: 10, preco: 10 }),
    lote({ produtoId: 3, saldoFiscal: 80, preco: 10 }),
    lote({ produtoId: 2, saldoFiscal: 300, preco: 10 }),
    lote({ produtoId: 1, saldoFiscal: 500, preco: 10 })
  ], 10);

  assert.deepEqual(result.vendas[0].itens.map((item) => item.produto_id), [1]);
});

test('recebimentos de R$ 20 e composição exata de R$ 20 não criam desconto', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 500, preco: 20 })
  ], 20);

  assert.equal(result.valor_informado, 20);
  assert.equal(result.valor_distribuido, 20);
  assert.equal(result.desconto, 0);
  assert.equal(result.valor_final, 20);
  assert.equal(result.diferenca, 0);
  assert.equal(result.perfeita, true);
});

test('não escolhe uma unidade acima do máximo se houver combinação válida alternativa', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 500, preco: 11 }),
    lote({ produtoId: 2, saldoFiscal: 300, preco: 10 })
  ], 10, { valorMax: 10 });

  assert.deepEqual(result.vendas[0].itens.map((item) => item.produto_id), [2]);
  assert.ok(result.vendas.every((venda) => venda.valor <= 10));
});

test('composição exata é escolhida antes de alternativa com saldo maior e excesso', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 500, preco: 10.01 }),
    lote({ produtoId: 2, saldoFiscal: 300, preco: 10 })
  ], 10, { valorMax: 20 });

  assert.deepEqual(result.vendas[0].itens.map((item) => item.produto_id), [2]);
  assert.equal(result.valor_distribuido, 10);
  assert.equal(result.valor_final, 10);
  assert.equal(result.desconto, 0);
  assert.equal(result.diferenca, 0);
  assert.equal(result.perfeita, true);
});

test('recebimentos de R$ 20 e composição de R$ 26,96 ficam pendentes sem desconto autorizado', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 500, preco: 26.96 })
  ], 20, { valorMax: 30 });

  assert.equal(result.valor_informado, 20);
  assert.equal(result.valor_distribuido, 26.96);
  assert.equal(result.desconto, 0);
  assert.equal(result.valor_final, 26.96);
  assert.equal(result.diferenca, -6.96);
  assert.equal(result.perfeita, false);
  assert.equal(result.incompleta, true);
  assert.equal(result.codigo, 'DIFERENCA_NAO_CONCILIADA');
  assert.ok(result.mensagem.includes('R$ 6.96'));
  assert.match(result.mensagem, /Não há regra autorizada de desconto/);
});

test('preserva o ajuste monetário quando a prioridade de produto é equivalente', () => {
  const result = previa([
    lote({ produtoId: 1, itemId: 12, saldoFiscal: 500, preco: 10.01 }),
    lote({ produtoId: 1, itemId: 11, saldoFiscal: 500, preco: 10 })
  ], 10, { valorMax: 20 });

  assert.equal(result.valor_distribuido, 10);
  assert.equal(result.vendas[0].itens[0].venda_item_origem_id, 11);
});

test('saldo zero e negativo não fornecem unidades selecionáveis', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 0, preco: 10 }),
    lote({ produtoId: 2, saldoFiscal: -5, preco: 10 }),
    lote({ produtoId: 3, saldoFiscal: 1, preco: 10 })
  ], 10);

  assert.deepEqual(result.vendas[0].itens.map((item) => item.produto_id), [3]);
});

test('limita quantidade selecionada ao saldo fiscal atual mesmo se o lote informar mais', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 2, quantidade: 10, preco: 5 })
  ], 10);

  assert.equal(result.porProduto[0].quantidade_utilizada, 2);
});

test('empacota várias vendas por prioridade e consome cada unidade uma única vez', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 500, quantidade: 2, preco: 5 }),
    lote({ produtoId: 2, saldoFiscal: 300, quantidade: 3, preco: 5 })
  ], 25, { valorAlvo: 10, valorMin: 1, valorMax: 10 });

  assert.equal(result.vendas.length, 3);
  assert.deepEqual(result.vendas[0].itens.map((item) => item.produto_id), [1]);
  assert.deepEqual(result.vendas.slice(1).map((venda) => venda.itens[0].quantidade), [2, 1]);
  assert.ok(result.vendas.every((venda) => venda.valor <= 10));
  assert.equal(result.porProduto.reduce((soma, item) => soma + item.quantidade_utilizada, 0), 5);
});

test('reequilibra os pacotes para respeitar o mínimo sem ultrapassar o máximo', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 4, quantidade: 4, preco: 60 })
  ], 240, { valorAlvo: 100, valorMin: 80, valorMax: 150 });

  assert.deepEqual(result.vendas.map((venda) => venda.valor), [120, 120]);
  assert.ok(result.vendas.every((venda) => venda.valor >= 80 && venda.valor <= 150));
  assert.equal(result.valor_distribuido, 240);
  assert.equal(result.porProduto[0].quantidade_utilizada, 4);
});

test('não emite prévia quando nenhuma composição respeita os limites mínimo e máximo', () => {
  const result = previa([
    lote({ produtoId: 1, saldoFiscal: 1, preco: 90 }),
    lote({ produtoId: 2, saldoFiscal: 1, preco: 70 })
  ], 160, { valorAlvo: 100, valorMin: 80, valorMax: 100 });

  assert.equal(result.codigo, 'SEM_COMPOSICAO_VALIDA');
  assert.equal(result.incompleta, true);
  assert.equal(result.vendas.length, 0);
});

test('prefere a próxima combinação válida quando o total prioritário não cabe nos limites', () => {
  const result = previa([
    lote({ produtoId: 1, itemId: 11, saldoFiscal: 500, preco: 9 }),
    lote({ produtoId: 1, itemId: 12, saldoFiscal: 500, preco: 6 }),
    lote({ produtoId: 2, saldoFiscal: 300, preco: 10 }),
    lote({ produtoId: 3, saldoFiscal: 80, preco: 10 })
  ], 20, { valorAlvo: 10, valorMin: 10, valorMax: 10 });

  assert.equal(result.valor_distribuido, 20);
  assert.deepEqual(result.vendas.map((venda) => venda.itens.map((item) => item.produto_id)), [
    [2],
    [3]
  ]);
});

test('modo por comprovante prioriza saldo e não reutiliza itens entre vendas', () => {
  const result = gerarPreviaPorComprovante([
    { valor: 10, ordem: 1 },
    { valor: 10, ordem: 2 }
  ], [
    lote({ produtoId: 2, saldoFiscal: 300, preco: 10 }),
    lote({ produtoId: 1, saldoFiscal: 500, preco: 10 })
  ], { valorMin: 1, valorMax: 10 });

  assert.deepEqual(
    result.vendas.map((venda) => venda.itens.map((item) => item.produto_id)),
    [[1], [2]]
  );
  assert.equal(result.vendas.reduce((soma, venda) =>
    soma + venda.itens.reduce((total, item) => total + item.quantidade, 0), 0), 2);
});

test('modo por comprovante deixa pendente valor abaixo do mínimo configurado', () => {
  const result = gerarPreviaPorComprovante(
    [{ valor: 5, ordem: 1 }],
    [lote({ produtoId: 1, saldoFiscal: 1, preco: 10 })],
    { valorMin: 8, valorMax: 100 }
  );

  assert.equal(result.vendas.length, 0);
  assert.equal(result.perfeita, false);
  assert.equal(result.incompleta, true);
});

test('saldos iguais usam ID como desempate determinístico', () => {
  const lotes = [
    lote({ produtoId: 20, saldoFiscal: 100, preco: 10 }),
    lote({ produtoId: 10, saldoFiscal: 100, preco: 10 })
  ];

  assert.deepEqual(previa(lotes, 10).vendas[0].itens.map((item) => item.produto_id), [10]);
  assert.deepEqual(previa(lotes, 10).vendas[0].itens.map((item) => item.produto_id), [10]);
});

test('carrega saldo_fiscal atual em lotes derivados de vendas sem alterar quantidade fiscal histórica', async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, item_fiscal INTEGER,
      saldo_fiscal REAL, preco_venda REAL
    )`);
    await run(db, `CREATE TABLE vendas (
      id INTEGER PRIMARY KEY, data_venda TEXT, total REAL, valor_fiscal REAL,
      valor_nao_fiscal REAL, status TEXT, cancelada INTEGER
    )`);
    await run(db, `CREATE TABLE vendas_itens (
      id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
      quantidade REAL, quantidade_fiscal REAL, quantidade_nao_fiscal REAL,
      subtotal REAL, valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
    )`);
    await run(db, `CREATE TABLE vendas_devolucoes (
      id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER,
      produto_id INTEGER, quantidade REAL, valor_total REAL
    )`);
    await run(db, `INSERT INTO produtos VALUES (1,'A','A',1,500,10)`);
    await run(db, `INSERT INTO vendas VALUES (1,'2026-10-16',10,10,0,'concluida',0)`);
    await run(db, `INSERT INTO vendas_itens VALUES (1,1,1,1,1,0,10,10,0,10)`);

    const lotes = await listarLotesElegiveisDoDia(db, '2026-10-16');
    assert.equal(lotes.length, 1);
    assert.equal(lotes[0].saldo_fiscal, 500);
    assert.equal(lotes[0].quantidade_disponivel, 1);
  } finally {
    await close(db);
  }
});
