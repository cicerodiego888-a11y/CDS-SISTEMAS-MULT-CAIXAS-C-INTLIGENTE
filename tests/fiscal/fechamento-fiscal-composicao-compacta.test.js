'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  agruparUnidades,
  gerarPreviaDistribuicao
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');

test('busca compacta respeita 7.300 unidades idênticas sem expandir objetos', () => {
  const lotes = [{
    produto_id: 1,
    nome: 'Produto centavo',
    venda_id: 0,
    venda_item_id: -1,
    unidade: 'UN',
    fracionado: false,
    quantidade_disponivel: 7300,
    valor_disponivel: 73,
    preco_unitario: 0.01,
    unit_cents: 1
  }];

  const inicio = Date.now();
  const grupos = agruparUnidades(lotes);
  const previa = gerarPreviaDistribuicao(lotes, 70, {
    valorAlvo: 70,
    valorMin: 1,
    valorMax: 100,
    distribuicaoRealista: false
  });
  const duracaoMs = Date.now() - inicio;

  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].quantidade_unidades, 7300);
  assert.equal(previa.valor_distribuido, 70);
  assert.equal(previa.valor_final, 70);
  assert.equal(previa.desconto, 0);
  assert.equal(previa.vendas.length, 1);
  assert.equal(previa.vendas[0].itens[0].quantidade, 7000);
  assert.ok(duracaoMs < 2000, `esperado < 2000ms, observado ${duracaoMs}ms`);
});