'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gerarPreviaDistribuicaoNoWorker
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoWorker');

test('cálculo de pool grande ocorre no worker e mantém resultado determinístico', async () => {
  const lotes = [{
    produto_id: 1,
    nome: 'Produto unitário',
    venda_id: 0,
    venda_item_id: -1,
    unidade: 'UN',
    fracionado: false,
    quantidade_disponivel: 7300,
    valor_disponivel: 73,
    preco_unitario: 0.01,
    unit_cents: 1
  }];
  const request = {
    tipo: 'normal',
    lotes,
    valorInformado: 70,
    opcoes: {
      valorAlvo: 70,
      valorMin: 1,
      valorMax: 100,
      distribuicaoRealista: false,
      metricasExecucao: {}
    }
  };
  let heartbeatExecutado = false;
  setImmediate(() => {
    heartbeatExecutado = true;
  });

  const primeira = await gerarPreviaDistribuicaoNoWorker(request);
  const segunda = await gerarPreviaDistribuicaoNoWorker(request);

  assert.equal(heartbeatExecutado, true);
  assert.equal(primeira.valor_distribuido, 70);
  assert.equal(primeira.valor_final, 70);
  assert.equal(primeira.vendas[0].itens[0].quantidade, 7000);
  assert.equal(primeira.metricas.produtos_elegiveis, 1);
  assert.equal(primeira.metricas.linhas_elegiveis, 1);
  assert.equal(primeira.metricas.grupos, 1);
  assert.ok(primeira.metricas.estados_avaliados > 0);
  assert.ok(primeira.metricas.transicoes_avaliadas > 0);
  assert.deepEqual(primeira.vendas, segunda.vendas);
});
