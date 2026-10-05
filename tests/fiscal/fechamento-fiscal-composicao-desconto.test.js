const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarPreviaDistribuicao } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');

test('COMPOSICAO — prioriza exata em vez de excesso', () => {
  const lotes = [
    { produto_id: 1, nome: 'A', venda_item_id: 1, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 10, preco_unitario: 10, unit_cents: 1000 },
    { produto_id: 2, nome: 'B', venda_item_id: 2, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 8, preco_unitario: 8, unit_cents: 800 },
    { produto_id: 3, nome: 'C', venda_item_id: 3, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 2, preco_unitario: 2, unit_cents: 200 }
  ];

  const previa = gerarPreviaDistribuicao(lotes, 10);
  assert.equal(previa.perfeita, true);
  assert.equal(previa.valor_distribuido, 10);
  assert.equal(previa.diferenca, 0);
  assert.equal(previa.desconto, 0);
});

test('COMPOSICAO — escolhe menor excesso e aplica desconto', () => {
  const lotes = [
    { produto_id: 1, nome: 'A', venda_item_id: 1, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 15, preco_unitario: 15, unit_cents: 1500 },
    { produto_id: 2, nome: 'B', venda_item_id: 2, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 10, preco_unitario: 10, unit_cents: 1000 },
    { produto_id: 3, nome: 'C', venda_item_id: 3, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 9.8, preco_unitario: 9.8, unit_cents: 980 },
    { produto_id: 4, nome: 'D', venda_item_id: 4, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 5, preco_unitario: 5, unit_cents: 500 }
  ];

  const previa = gerarPreviaDistribuicao(lotes, 28);
  assert.equal(previa.desconto, 1.8);
  assert.equal(previa.valor_distribuido, 29.8);
  assert.equal(previa.valor_final, 28);
  assert.equal(previa.diferenca, 0);
  assert.equal(previa.perfeita, true);
  assert.equal(previa.incompleta, false);
});

test('COMPOSICAO — rejeita abaixo do alvo sem inventar valor', () => {
  const lotes = [
    { produto_id: 1, nome: 'A', venda_item_id: 1, unidade: 'UN', fracionado: false, quantidade_disponivel: 1, valor_disponivel: 27.5, preco_unitario: 27.5, unit_cents: 2750 }
  ];

  const previa = gerarPreviaDistribuicao(lotes, 28);
  assert.equal(previa.valor_distribuido, 0);
  assert.equal(previa.diferenca, 28);
  assert.equal(previa.quantidade_vendas, 0);
  assert.equal(previa.desconto, 0);
  assert.ok(previa.codigo === 'ABAIXO_DO_ALVO' || previa.codigo === 'DISTRIBUICAO_FALHOU' || previa.codigo === 'UNIDADE_SUPERIOR');
});
