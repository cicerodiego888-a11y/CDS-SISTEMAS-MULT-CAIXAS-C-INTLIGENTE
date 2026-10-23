'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const atual = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');
const referencia = require('./fixtures/DistribuicaoReferencia');

function criarRandom(semente) {
  let seed = semente;
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function gerarLotes(rnd, produtos, linhas, { fracionados, saldo }) {
  const lotes = [];
  for (let i = 0; i < linhas; i += 1) {
    const preco = Math.round((0.5 + rnd() * 30) * 100) / 100;
    const frac = fracionados && rnd() < 0.25;
    const qtd = frac ? Math.round((0.3 + rnd() * 3) * 1000) / 1000 : 1 + Math.floor(rnd() * 8);
    const produto = 1 + Math.floor(rnd() * produtos);
    lotes.push({
      produto_id: produto,
      nome: `P${produto}`,
      venda_id: i,
      venda_item_id: i + 1,
      unidade: frac ? 'KG' : 'UN',
      fracionado: frac,
      quantidade_disponivel: qtd,
      valor_disponivel: Math.round(preco * qtd * 100) / 100,
      preco_unitario: preco,
      unit_cents: Math.round(preco * 100),
      saldo_fiscal: saldo && rnd() < 0.7 ? Math.round(qtd * 10) / 10 + Math.floor(rnd() * 4) : null
    });
  }
  return lotes;
}

function semMetricas(obj) {
  return JSON.stringify(obj, (chave, valor) => (chave === 'metricas' || chave === 'tempo_ms' ? undefined : valor));
}

test('selecionarUnidadesCompactas: 400 casos idÃªnticos Ã  implementaÃ§Ã£o de referÃªncia', () => {
  const rnd = criarRandom(20261022);
  let comResultado = 0;
  for (let caso = 0; caso < 400; caso += 1) {
    const lotes = gerarLotes(rnd, 2 + Math.floor(rnd() * 8), 3 + Math.floor(rnd() * 14), {
      fracionados: caso % 3 === 0,
      saldo: caso % 2 === 0
    });
    const grupos = atual.agruparUnidades(lotes);
    const capacidade = grupos.reduce((t, g) => t + g.quantidade_unidades * g.valor_cents, 0);
    const alvo = Math.max(1, Math.floor(capacidade * (0.05 + rnd() * 0.6)));
    const opcoes = {};
    const modo = caso % 4;
    if (modo === 1) opcoes.maxSomaCents = alvo;
    if (modo === 2) {
      opcoes.minVendaCents = 1000;
      opcoes.maxVendaCents = 12000;
      opcoes.maxValorUnidadeCents = 12000;
    }
    if (modo === 3) {
      opcoes.minSomaCents = Math.max(0, alvo - Math.floor(rnd() * 500));
      opcoes.maxSomaCents = alvo + Math.floor(rnd() * 800);
    }
    const uso = new Map();
    if (caso % 5 === 0) for (let p = 1; p <= 4; p += 1) uso.set(p, Math.floor(rnd() * 6));
    const a = atual.selecionarUnidadesCompactas(grupos, alvo, { ...opcoes, usoPorProduto: uso, metricasExecucao: {} });
    const b = referencia.selecionarUnidadesCompactas(grupos, alvo, { ...opcoes, usoPorProduto: uso, metricasExecucao: {} });
    assert.equal(JSON.stringify(a), JSON.stringify(b), `caso ${caso} divergente`);
    if (a.somaCents > 0) comResultado += 1;
  }
  assert.ok(comResultado > 150, `poucos casos com resultado (${comResultado})`);
});

test('gerarPreviaDistribuicao: 120 casos completos idÃªnticos Ã  referÃªncia (exceto mÃ©tricas)', () => {
  const rnd = criarRandom(777);
  for (let caso = 0; caso < 120; caso += 1) {
    const lotes = gerarLotes(rnd, 3 + Math.floor(rnd() * 8), 5 + Math.floor(rnd() * 20), {
      fracionados: caso % 3 === 0,
      saldo: caso % 2 === 0
    });
    const alvo = 50 + Math.floor(rnd() * 300);
    const opcoes = { valorAlvo: 60, valorMin: 10, valorMax: 120, distribuicaoRealista: false };
    const a = atual.gerarPreviaDistribuicao(lotes, alvo, { ...opcoes, metricasExecucao: {} });
    const b = referencia.gerarPreviaDistribuicao(lotes, alvo, { ...opcoes, metricasExecucao: {} });
    assert.equal(semMetricas(a), semMetricas(b), `caso ${caso} divergente`);
  }
});

test('selecionarUnidadesCompactas: quantidades grandes (Uint16/Int32) e fracionados multiunidade idênticos à referência', () => {
  let comResultado = 0;
  const rnd = criarRandom(4242);
  for (let caso = 0; caso < 90; caso += 1) {
    const lotes = gerarLotes(rnd, 2 + Math.floor(rnd() * 5), 3 + Math.floor(rnd() * 8), {
      fracionados: false,
      saldo: caso % 2 === 0
    });
    const grupos = atual.agruparUnidades(lotes).map((grupo, indice) => {
      const copia = { ...grupo };
      if (caso % 3 === 0) {
        copia.quantidade_unidades *= 40;
      } else if (caso % 3 === 1 && indice === 0) {
        copia.quantidade_unidades = 70000;
        copia.valor_cents = 1;
      }
      if (caso % 4 === 1 && copia.quantidade_unidades > 1) copia.quantidade_por_unidade = 0.37 + indice / 100;
      return copia;
    });
    const alvo = 100 + Math.floor(rnd() * 900);
    const uso = new Map([[1, caso % 5]]);
    const opcoes = caso % 2 === 1 ? { maxSomaCents: alvo + 50 } : {};
    const a = atual.selecionarUnidadesCompactas(grupos, alvo, { ...opcoes, usoPorProduto: uso, metricasExecucao: {} });
    const b = referencia.selecionarUnidadesCompactas(grupos, alvo, { ...opcoes, usoPorProduto: uso, metricasExecucao: {} });
    assert.equal(JSON.stringify(a), JSON.stringify(b), `caso ${caso} divergente`);
  }
});

test('selecionarUnidadesCompactas: saldo fiscal com mais de 32 produtos (máscara multi-palavra) idêntico à referência', () => {
  const rnd = criarRandom(9090);
  let comResultado = 0;
  for (let caso = 0; caso < 60; caso += 1) {
    const produtos = 34 + Math.floor(rnd() * 40);
    const lotes = gerarLotes(rnd, produtos, produtos + Math.floor(rnd() * 20), { fracionados: caso % 3 === 0, saldo: true });
    const grupos = atual.agruparUnidades(lotes);
    const alvo = 300 + Math.floor(rnd() * 1500);
    const uso = new Map([[1, caso % 4], [40, caso % 3]]);
    const opcoes = caso % 2 === 1 ? { maxSomaCents: alvo + 30 } : {};
    const a = atual.selecionarUnidadesCompactas(grupos, alvo, { ...opcoes, usoPorProduto: uso, metricasExecucao: {} });
    const b = referencia.selecionarUnidadesCompactas(grupos, alvo, { ...opcoes, usoPorProduto: uso, metricasExecucao: {} });
    assert.equal(JSON.stringify(a), JSON.stringify(b), `caso ${caso} divergente`);
    if (a.somaCents > 0) comResultado += 1;
  }
  assert.ok(comResultado > 30, `poucos casos com resultado (${comResultado})`);
});
