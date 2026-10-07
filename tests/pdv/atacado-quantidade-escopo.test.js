/**
 * Escopo de obterPrecoAtacado na alteração de quantidade do PDV.
 * A regra de faixa permanece a que já estava na função; o teste só
 * confirma que atualizarQuantidade consegue chamá-la.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Trecho não encontrado: ${startMarker} → ${endMarker}`);
  }
  return src.slice(start, end);
}

function carregarMotor() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/motor-preco-atacado.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.MotorPrecoAtacado;
}

function carregarFluxo() {
  const MotorPrecoAtacado = carregarMotor();
  const faixasPorId = {};
  let ajaxChamadas = 0;
  const $ = {
    ajax(opcoes) {
      ajaxChamadas += 1;
      const match = String(opcoes.url || '').match(/\/produtos\/(\d+)\/atacado/);
      const id = match ? match[1] : '';
      opcoes.success(faixasPorId[id] || []);
    }
  };
  const factory = new Function('$, API_URL, localStorage, MotorPrecoAtacado', `
    let carrinho = [];
    let produtosDisponiveis = [];
    let estoqueBloqueado = false;
    let renders = 0;
    function motorPrecoAtacadoDisponivel() {
      return typeof MotorPrecoAtacado !== 'undefined' && MotorPrecoAtacado != null;
    }
    function itemVendaPorUnidade(item) {
      return String(item && item.tipo_venda || '').toUpperCase() === 'UNIDADE';
    }
    function parseQuantidadePdv(valor) {
      const n = Number(valor);
      return Number.isFinite(n) ? n : NaN;
    }
    function normalizarQuantidadePdv(quantidade) {
      return Number(quantidade);
    }
    function obterQuantidadeEstoqueParaVenda(_produto, quantidade) {
      return Number(quantidade || 0);
    }
    function showNotification() {}
    function pdvValidarEstoqueVenda() {
      if (estoqueBloqueado) return { sucesso: false, semSaldoTotal: true };
      return { sucesso: true };
    }
    function pdvNotificarEstoqueInsuficiente() {
      return !estoqueBloqueado;
    }
    function abrirModalVendaSemEstoquePdv() {}
    function animarTotalLinhaCarrinho() {}
    function atualizarCarrinho() { renders += 1; }
    function focarCampoCodigo() {}
    function removerItemCarrinho(index) { carrinho.splice(index, 1); }
    ${extract(pdv, 'function obterPrecoBaseItemPdv', 'function aplicarCalculoMotorItemPdv')}
    ${extract(pdv, 'function aplicarCalculoMotorItemPdv', 'function operadorPodeAplicarDescontoSemSenha')}
    ${extract(pdv, 'function obterPrecoAtacado', 'function adicionarItemNoCarrinho')}
    ${extract(pdv, 'function atualizarQuantidade', 'function atualizarPercentual')}
    return {
      ajaxChamadas() { return ajaxChamadas; },
      zerarAjax() { ajaxChamadas = 0; },
      bloquearEstoque(v) { estoqueBloqueado = v === true; },
      renders() { return renders; },
      montar(produto, item) {
        produtosDisponiveis = [produto];
        carrinho = [item];
        return item;
      },
      item() { return carrinho[0]; },
      obterPrecoAtacado,
      atualizarQuantidade
    };
  `);
  const api = factory($, 'http://local/api', { getItem: () => '' }, MotorPrecoAtacado);
  api.definirFaixas = (id, faixas) => { faixasPorId[String(id)] = faixas; };
  api.ajaxChamadas = () => ajaxChamadas;
  return api;
}

function produtoBase(extra = {}) {
  return {
    id: 10,
    nome: 'Açai',
    unidade: 'UN',
    preco_venda: 55,
    preco_unidade: 8,
    venda_atacado: 0,
    ...extra
  };
}

function itemBase(extra = {}) {
  return {
    id: 10,
    nome: 'Açai',
    quantidade: 1,
    preco_unitario: 55,
    preco_base: 55,
    desconto_atacado: 0,
    desconto_percentual: 0,
    desconto_valor: 0,
    tipo_preco: 'varejo',
    tipo_venda: 'PESO',
    subtotal: 55,
    ...extra
  };
}

const FAIXAS = [
  { quantidade_minima: 30, preco_atacado: 40 },
  { quantidade_minima: 50, preco_atacado: 35 }
];

describe('escopo obterPrecoAtacado', () => {
  it('a função fica no módulo e os dois fluxos passam o produto', () => {
    const declaracoes = pdv.match(/function obterPrecoAtacado/g) || [];
    assert.equal(declaracoes.length, 1);
    const posFuncao = pdv.indexOf('function obterPrecoAtacado');
    const posInclusao = pdv.indexOf('function adicionarItemNoCarrinho');
    const posQtd = pdv.indexOf('function atualizarQuantidade');
    assert.ok(posFuncao < posInclusao);
    assert.ok(posFuncao < posQtd);
    assert.equal((extract(pdv, 'function adicionarItemNoCarrinho', 'function continuarAdicionarProdutoPdv').match(/function obterPrecoAtacado/g) || []).length, 0);
    assert.match(extract(pdv, 'function obterPrecoAtacado', 'function adicionarItemNoCarrinho'), /produto\.preco_venda/);
    assert.doesNotMatch(extract(pdv, 'function obterPrecoAtacado', 'function adicionarItemNoCarrinho'), /quantidadeTotal >= 30/);
    const inclusao = extract(pdv, 'function adicionarItemNoCarrinho', 'function continuarAdicionarProdutoPdv');
    assert.equal((inclusao.match(/obterPrecoAtacado\(produto, produto\.id,/g) || []).length, 2);
    const qtd = extract(pdv, 'function atualizarQuantidade', 'function atualizarPercentual');
    assert.match(qtd, /obterPrecoAtacado\(produto, produto\.id, novaQuantidade, precoAplicado\)/);
    assert.ok(qtd.indexOf('pdvNotificarEstoqueInsuficiente') < qtd.indexOf('obterPrecoAtacado'));
    assert.ok(qtd.indexOf('item.quantidade = novaQuantidade') > qtd.indexOf('obterPrecoAtacado'));
  });
});

describe('alteração de quantidade', () => {
  it('1. produto sem atacado atualiza subtotal e total sem consultar faixa', () => {
    const fluxo = carregarFluxo();
    const produto = produtoBase();
    const item = fluxo.montar(produto, itemBase());
    fluxo.atualizarQuantidade(0, 3);
    assert.equal(fluxo.ajaxChamadas(), 0);
    assert.equal(item.quantidade, 3);
    assert.equal(item.preco_unitario, 55);
    assert.equal(item.subtotal, 165);
    assert.equal(item.subtotal_exibicao, 165);
    assert.equal(item.tipo_preco, 'varejo');
  });

  it('2. abaixo da primeira faixa permanece varejo', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1 });
    const item = fluxo.montar(produto, itemBase());
    fluxo.atualizarQuantidade(0, 10);
    assert.equal(item.preco_unitario, 55);
    assert.equal(item.tipo_preco, 'varejo');
    assert.equal(item.desconto_atacado, 0);
    assert.equal(item.subtotal, 550);
  });

  it('3. ao atingir a faixa aplica preco_atacado, selo e totais', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1 });
    const item = fluxo.montar(produto, itemBase());
    fluxo.atualizarQuantidade(0, 30);
    assert.equal(item.preco_unitario, 40);
    assert.equal(item.tipo_preco, 'atacado');
    assert.equal(item.desconto_atacado, 450);
    assert.equal(item.quantidade, 30);
    assert.equal(item.subtotal, 1200);
    assert.equal(item.subtotal_exibicao, 1200);
  });

  it('4. reduzir abaixo da faixa devolve o preço passado para a função', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1, preco_venda: 55 });
    const item = fluxo.montar(produto, itemBase({
      quantidade: 30,
      preco_unitario: 40,
      preco_base: 55,
      tipo_preco: 'atacado',
      desconto_atacado: 450,
      subtotal: 1200
    }));
    fluxo.atualizarQuantidade(0, 10);
    const direto = fluxo.obterPrecoAtacado(produto, produto.id, 10, 40);
    assert.equal(direto.preco, 40);
    assert.equal(direto.isAtacado, false);
    assert.equal(item.preco_unitario, direto.preco);
    assert.equal(item.tipo_preco, 'varejo');
    assert.equal(item.quantidade, 10);
  });

  it('5. múltiplas faixas escolhem a maior quantidade_minima atingida', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1 });
    const meio = fluxo.obterPrecoAtacado(produto, produto.id, 40, 55);
    const topo = fluxo.obterPrecoAtacado(produto, produto.id, 50, 55);
    assert.equal(meio.preco, 40);
    assert.equal(topo.preco, 35);
    assert.equal(topo.isAtacado, true);
    const item = fluxo.montar(produto, itemBase());
    fluxo.atualizarQuantidade(0, 50);
    assert.equal(item.preco_unitario, 35);
    assert.equal(item.tipo_preco, 'atacado');
    assert.equal(item.subtotal, 1750);
  });

  it('6. venda por unidade não aplica atacado', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1 });
    const item = fluxo.montar(produto, itemBase({
      tipo_venda: 'UNIDADE',
      preco_unitario: 8,
      preco_base: 8,
      quantidade: 1,
      subtotal: 8
    }));
    fluxo.atualizarQuantidade(0, 40);
    assert.equal(fluxo.ajaxChamadas(), 0);
    assert.equal(item.preco_unitario, 8);
    assert.equal(item.tipo_preco, 'varejo');
    assert.equal(item.quantidade, 40);
    assert.equal(item.subtotal, 320);
  });

  it('7. etiqueta de balança não consulta atacado', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1, unidade: 'KG', preco_venda: 55 });
    const item = fluxo.montar(produto, itemBase({
      etiqueta_balanca: { tipoPayload: 'PESO', subtotalFixo: null },
      quantidade: 1,
      preco_unitario: 55,
      subtotal: 55
    }));
    fluxo.atualizarQuantidade(0, 40);
    assert.equal(fluxo.ajaxChamadas(), 0);
    assert.equal(item.tipo_preco, 'varejo');
    assert.equal(item.preco_unitario, 55);
    assert.equal(item.quantidade, 40);
    assert.equal(item.subtotal, 2200);
  });

  it('8. estoque insuficiente não grava a quantidade nova', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    fluxo.bloquearEstoque(true);
    const produto = produtoBase({ venda_atacado: 1 });
    const item = fluxo.montar(produto, itemBase());
    fluxo.atualizarQuantidade(0, 30);
    assert.equal(item.quantidade, 1);
    assert.equal(item.preco_unitario, 55);
    assert.equal(item.subtotal, 55);
    assert.equal(fluxo.ajaxChamadas(), 0);
  });

  it('9. campos usados na finalização ficam consistentes com o carrinho', () => {
    const fluxo = carregarFluxo();
    fluxo.definirFaixas(10, FAIXAS);
    const produto = produtoBase({ venda_atacado: 1 });
    const item = fluxo.montar(produto, itemBase());
    fluxo.atualizarQuantidade(0, 30);
    const payloadSrc = extract(pdv, 'itens: carrinho.map(item => {', 'if (tipoVendaEhUnidade(tipoVenda) && produto)');
    assert.match(payloadSrc, /quantidade/);
    assert.match(payloadSrc, /preco_unitario/);
    assert.match(payloadSrc, /subtotal/);
    assert.match(payloadSrc, /tipo_preco: item\.tipo_preco/);
    assert.equal(item.quantidade, 30);
    assert.equal(item.preco_unitario, 40);
    assert.equal(item.subtotal, 1200);
    assert.equal(item.subtotal_exibicao, 1200);
    assert.equal(Number((item.preco_unitario * item.quantidade).toFixed(2)), item.subtotal);
  });
});
