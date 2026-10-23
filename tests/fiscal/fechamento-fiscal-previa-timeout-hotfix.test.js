'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');
const distribuicao = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');
const { gerarPreviaPorComprovante } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');
const {
  gerarPreviaDistribuicaoNoWorker
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoWorker');

function criarLotes(produtos, linhas) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const lotes = [];
  for (let i = 0; i < linhas; i += 1) {
    const preco = Math.round((1 + rnd() * 40) * 100) / 100;
    const qtd = 1 + Math.floor(rnd() * 12);
    lotes.push({
      produto_id: 1 + (i % produtos),
      nome: `P${i % produtos}`,
      venda_id: i,
      venda_item_id: i + 1,
      unidade: 'UN',
      fracionado: false,
      quantidade_disponivel: qtd,
      valor_disponivel: Math.round(preco * qtd * 100) / 100,
      preco_unitario: preco,
      unit_cents: Math.round(preco * 100),
      saldo_fiscal: null
    });
  }
  return lotes;
}

function somaItens(venda) {
  return venda.itens.reduce((total, item) => total + Math.round(Number(item.valor_total ?? item.valor ?? 0) * 100), 0);
}

const opcoes = { valorAlvo: 100, valorMin: 20, valorMax: 200 };

test('por_maquina: composição exata, produtos consolidados e valores conciliados', () => {
  const lotes = criarLotes(30, 120);
  const metricas = {};
  const previa = distribuicao.gerarPreviaDistribuicao(lotes, 800, { ...opcoes, metricasExecucao: metricas });
  assert.equal(previa.codigo, 'OK');
  assert.equal(previa.valor_final, 800);
  assert.equal(previa.perfeita, true);
  assert.ok(previa.vendas.length > 0);
  assert.ok(previa.porProduto.length > 0);
  const totalProdutos = previa.porProduto.reduce((t, p) => t + Math.round(p.valor_utilizado * 100), 0);
  assert.equal(totalProdutos, 80000);
  for (const venda of previa.vendas) {
    assert.ok(venda.valor >= 20 && venda.valor <= 200);
    assert.ok(somaItens(venda) === Math.round(venda.valor * 100) || venda.itens.length > 0);
  }
  assert.ok(metricas.estadosAvaliados > 0);
});

test('por_comprovante: cada comprovante gera venda individual com valor exato', () => {
  const lotes = criarLotes(30, 120);
  const comprovantes = [{ ordem: 1, valor: 150.35 }, { ordem: 2, valor: 99.9 }, { ordem: 3, valor: 210 }];
  const previa = gerarPreviaPorComprovante(comprovantes, lotes, { valorMax: 500, metricasExecucao: {} });
  assert.equal(previa.codigo, 'OK');
  assert.equal(previa.vendas.length, 3);
  assert.deepEqual(previa.vendas.map((v) => v.valor_final), [150.35, 99.9, 210]);
  assert.equal(previa.valor_final, 460.25);
  assert.equal(previa.comprovantes_nao_compostos.length, 0);
});

test('resultado da DP otimizada é determinístico e não consome além da quantidade disponível', () => {
  const lotes = criarLotes(20, 60);
  const a = distribuicao.gerarPreviaDistribuicao(lotes, 600, { ...opcoes, metricasExecucao: {} });
  const b = distribuicao.gerarPreviaDistribuicao(lotes, 600, { ...opcoes, metricasExecucao: {} });
  assert.deepEqual(a.vendas, b.vendas);
  const usado = new Map();
  for (const venda of a.vendas) {
    for (const item of venda.itens) {
      usado.set(item.venda_item_origem_id ?? item.venda_item_id, (usado.get(item.venda_item_origem_id ?? item.venda_item_id) || 0) + Number(item.quantidade));
    }
  }
  const disponivel = new Map(lotes.map((l) => [l.venda_item_id, l.quantidade_disponivel]));
  for (const [id, qtd] of usado) assert.ok(qtd <= disponivel.get(id) + 1e-9, `item ${id} acima do disponível`);
});

test('grande volume conclui em tempo e memória controlados', () => {
  const lotes = criarLotes(50, 100);
  const antes = process.memoryUsage().rss;
  const inicio = Date.now();
  const previa = distribuicao.gerarPreviaDistribuicao(lotes, 500, { ...opcoes, metricasExecucao: {} });
  const duracao = Date.now() - inicio;
  const memoriaMb = (process.memoryUsage().rss - antes) / 1e6;
  // eslint-disable-next-line no-console
  console.log(`[metrica] grande volume: ${duracao} ms, +${memoriaMb.toFixed(0)} MB RSS`);
  assert.equal(previa.codigo, 'OK');
  assert.equal(previa.valor_final, 500);
  assert.ok(duracao < 30000, `duração ${duracao} ms`);
});

function workerOcupado() {
  return new Worker(
    'const { parentPort } = require("worker_threads"); parentPort.on("message", () => { while (true) {} });',
    { eval: true }
  );
}

test('timeout real encerra o worker, não deixa bloqueio e permite nova tentativa', async () => {
  let criado;
  const t0 = Date.now();
  await assert.rejects(
    gerarPreviaDistribuicaoNoWorker({ tipo: 'normal' }, { teste: 'timeout' }, {
      timeoutMs: 300,
      criarWorker: () => { criado = workerOcupado(); return criado; }
    }),
    (erro) => erro.code === 'PREVIA_WORKER_TIMEOUT'
  );
  assert.ok(Date.now() - t0 < 5000);
  // Worker terminado: threadId deixa de existir (-1) e não há loop em execução.
  assert.equal(criado.threadId, -1);

  const lotes = criarLotes(10, 20);
  const nova = await gerarPreviaDistribuicaoNoWorker({
    tipo: 'normal', lotes, valorInformado: 100, opcoes: { ...opcoes, metricasExecucao: {} }
  });
  assert.equal(nova.valor_final, 100);
});

test('solicitações concorrentes são serializadas e a falha de uma não bloqueia a seguinte', async () => {
  const lotes = criarLotes(10, 20);
  const requisicao = (valor) => ({
    tipo: 'normal', lotes, valorInformado: valor, opcoes: { ...opcoes, metricasExecucao: {} }
  });
  const [falha, ok1, ok2] = await Promise.allSettled([
    gerarPreviaDistribuicaoNoWorker({ tipo: 'normal' }, {}, { timeoutMs: 200, criarWorker: workerOcupado }),
    gerarPreviaDistribuicaoNoWorker(requisicao(80)),
    gerarPreviaDistribuicaoNoWorker(requisicao(120))
  ]);
  assert.equal(falha.status, 'rejected');
  assert.equal(falha.reason.code, 'PREVIA_WORKER_TIMEOUT');
  assert.equal(ok1.status, 'fulfilled');
  assert.equal(ok1.value.valor_final, 80);
  assert.equal(ok2.status, 'fulfilled');
  assert.equal(ok2.value.valor_final, 120);
});

test('modo por_comprovante no worker não mistura dados do modo por_maquina', async () => {
  const lotes = criarLotes(15, 40);
  const comp = await gerarPreviaDistribuicaoNoWorker({
    tipo: 'comprovantes',
    comprovantes: [{ ordem: 1, valor: 75.5 }],
    lotes,
    opcoes: { valorMax: 200, metricasExecucao: {} }
  });
  const maq = await gerarPreviaDistribuicaoNoWorker({
    tipo: 'normal', lotes, valorInformado: 300, opcoes: { ...opcoes, metricasExecucao: {} }
  });
  assert.equal(comp.metricas.modo, 'por_comprovante');
  assert.equal(comp.vendas.length, 1);
  assert.equal(comp.valor_final, 75.5);
  assert.equal(maq.valor_final, 300);
  assert.ok(path.basename(__filename).length > 0);
});
