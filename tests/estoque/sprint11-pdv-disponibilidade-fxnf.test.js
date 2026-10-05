/**
 * Sprint 11 — Correção definitiva do bloqueio "Disponível: 0" para F=0 / NF=1.
 *
 * Regras alvo:
 * - o PDV deve permitir inclusão quando o total disponível F + NF > 0;
 * - a reserva não fiscal deve continuar bloqueando a inclusão quando comprometida;
 * - o motor central F×NF continua inalterado;
 * - F12 só prioriza natureza, não zera o estoque disponível não fiscal.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const pdvSrc = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const helpersSrc = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/modoFiscalHelpers.js'), 'utf8');

const { saldosDisponiveisMotorFxNf } = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const { prepararEntradasMotorComTransferenciaPdv } = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { distribuirItensVendaComValorFiscalEfetivo } = require('../../backend/services/distribuidorEstoqueVenda');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Marcador não encontrado: ${startMarker}`);
  return src.slice(start, end);
}

function produto(fiscal, naoFiscal, { itemFiscal = 1, controla = 1, resF = 0, resNF = 0 } = {}) {
  return {
    id: 9000 + Math.random() * 10000,
    nome: 'Produto Sprint 11',
    saldo_fiscal: fiscal,
    saldo_nao_fiscal: naoFiscal,
    estoque_atual: fiscal + naoFiscal,
    reservado_fiscal: resF,
    reservado_nao_fiscal: resNF,
    item_fiscal: itemFiscal,
    controla_estoque: controla,
    categoria: 'teste'
  };
}

function carregarPdv({ f12 = false, semEstoque = false } = {}) {
  const localStorage = { getItem: (k) => (k === 'pdv_modo_fiscal_ativo' ? (f12 ? '1' : '0') : null) };
  const window = {};
  return new Function('window', 'localStorage', `
    let produtosDisponiveis = [];
    function sincronizarProdutosDisponiveisGlobal() { window.produtosDisponiveis = produtosDisponiveis; }
    function normalizarProdutoPdvLista(l) { return l; }
    function pdvProdutoPermitidoNoModoAtual() { return true; }
    function upsertProdutoNoCatalogoPdv() {}
    function pdvModoFiscalAtivo() { return ${f12 === true}; }
    function pdvPermitirVendaSemEstoque() { return ${semEstoque === true}; }
    function formatarQuantidadePdv(n) { return String(n); }
    function showNotification() {}
    ${extract(helpersSrc, 'function modoFiscalQueryParam', 'function obterEstoqueExibicaoSimplesProduto')}
    ${extract(pdvSrc, 'function pdvTotalSaldosProduto', 'let recarregarCatalogoPdvInflight')}
    ${extract(pdvSrc, 'function pdvResolverSaldosProduto', 'function round3TransferenciaPdv')}
    ${extract(pdvSrc, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    ${extract(pdvSrc, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
    ${extract(pdvSrc, 'function validarEstoqueVenda', 'function pdvNotificarBloqueioInclusaoProduto')}
    return {
      setCatalogo(l) { produtosDisponiveis = l; sincronizarProdutosDisponiveisGlobal(); },
      catalogo() { return produtosDisponiveis; },
      mesclarProdutoCatalogoPdv,
      upsertProdutoNoCatalogoPdv,
      pdvPodeIniciarInclusaoProduto,
      pdvValidarEstoqueVenda,
      pdvSaldosDisponiveisMotorProduto,
      pdvResolverSaldosProduto
    };
  `)(window, localStorage);
}

function motor(p, qtd, { f12 = false, semEstoque = false } = {}) {
  const disp = saldosDisponiveisMotorFxNf(p);
  const s = saldosParaDistribuicaoVenda(p, qtd, disp.saldoFiscal, disp.saldoNaoFiscal);
  const subtotal = Number((qtd * 5.39).toFixed(2));
  const prep = prepararEntradasMotorComTransferenciaPdv([{
    item: { produto_id: p.id, quantidade: qtd, preco_unitario: 5.39, subtotal, unidade: 'UN' },
    saldoFiscal: s.saldoFiscal,
    saldoNaoFiscal: s.saldoNaoFiscal,
    controlaEstoque: Number(p.controla_estoque) !== 0,
    itemFiscal: Number(p.item_fiscal || 0),
    produto: p
  }], { permitido: false });

  return distribuirItensVendaComValorFiscalEfetivo(prep.entradas, f12, {
    pagamentos: [{ forma_pagamento: 'pix', valor: subtotal }],
    midpAtivo: false,
    permitirVendaSemEstoque: semEstoque
  });
}

function mensagemBloqueio(p, r) {
  return r.semSaldoTotal ? r.mensagem : r.mensagem.replace('Saldo insuficiente.', `Saldo insuficiente para ${p.nome}.`);
}

function pdvInsere(p, qtd, ctx = {}) {
  const pdv = carregarPdv(ctx);
  pdv.setCatalogo([p]);
  const inicio = pdv.pdvPodeIniciarInclusaoProduto(p);
  if (!inicio.sucesso) return { ok: false, mensagem: mensagemBloqueio(p, inicio) };
  const v = pdv.pdvValidarEstoqueVenda(p, qtd);
  if (!v.sucesso && !v.confirmarSemEstoque) return { ok: false, mensagem: mensagemBloqueio(p, v) };
  return { ok: true, confirmarSemEstoque: v.confirmarSemEstoque === true };
}

const qtds = (r) => [r.itens[0].quantidade_fiscal, r.itens[0].quantidade_nao_fiscal];

describe('Sprint 11 — PDV: disponibilidade F×NF total sem zerar NF disponível', () => {
  it('F0/NF1 sem comprometido → permite (F12 ON)', () => {
    const p = produto(0, 1);
    const inc = pdvInsere(p, 1, { f12: true });
    assert.equal(inc.ok, true, inc.mensagem);
    assert.ok(!String(inc.mensagem || '').includes('Disponível: 0'));
    const r = motor(p, 1, { f12: true });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [0, 1]);
  });

  it('F0/NF1 sem comprometido → permite (F12 OFF)', () => {
    const p = produto(0, 1);
    const inc = pdvInsere(p, 1, { f12: false });
    assert.equal(inc.ok, true, inc.mensagem);
    assert.ok(!String(inc.mensagem || '').includes('Disponível: 0'));
    const r = motor(p, 1, { f12: false });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [0, 1]);
  });

  it('F0/NF0 → bloqueia', () => {
    const p = produto(0, 0);
    const inc = pdvInsere(p, 1, { f12: true });
    assert.equal(inc.ok, false);
    assert.match(inc.mensagem, /não tem saldo|Saldo insuficiente/);
  });

  it('F0/NF1 comprometido 1 → bloqueia', () => {
    const p = produto(0, 1, { resNF: 1 });
    const inc = pdvInsere(p, 1, { f12: true });
    assert.equal(inc.ok, false);
    assert.ok(/Disponível: 0/.test(inc.mensagem || ''));
  });

  it('F1/NF0 → permite', () => {
    const p = produto(1, 0);
    const inc = pdvInsere(p, 1, { f12: false });
    assert.equal(inc.ok, true, inc.mensagem);
    const r = motor(p, 1, { f12: false });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [1, 0]);
  });

  it('F1/NF1 Q2 → permite; motor recebe 1F + 1NF', () => {
    const p = produto(1, 1);
    const inc = pdvInsere(p, 2, { f12: false });
    assert.equal(inc.ok, true, inc.mensagem);
    const r = motor(p, 2, { f12: false });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [1, 1]);
  });

  it('última unidade NF disponível consegue entrar quando não comprometida', () => {
    const p = produto(0, 1);
    const primeira = pdvInsere(p, 1, { f12: true });
    assert.equal(primeira.ok, true);
    const pDepois = { ...p, saldo_nao_fiscal: 0, estoque_atual: 0 };
    const segunda = pdvInsere(pDepois, 1, { f12: true });
    assert.equal(segunda.ok, false);
    assert.match(segunda.mensagem, /Saldo insuficiente|não tem saldo/);
  });

  it('nenhuma unidade disponível → bloqueia', () => {
    const p = produto(0, 0);
    const inc = pdvInsere(p, 1, { f12: false });
    assert.equal(inc.ok, false);
  });

  it('total disponível usa F + NF menos reservado, sem criar estoque zero', () => {
    const p = produto(0, 1, { resNF: 0 });
    const pdv = carregarPdv({ f12: true });
    pdv.setCatalogo([p]);
    const calc = pdv.pdvSaldosDisponiveisMotorProduto(p);
    assert.equal(calc.saldo_fiscal, 0);
    assert.equal(calc.saldo_nao_fiscal, 1);
    assert.equal(calc.estoque_atual, 1);
    assert.equal(pdv.pdvPodeIniciarInclusaoProduto(p).sucesso, true);
  });

  it('o refresh oficial não preserva reserva antiga do cache quando a disponibilidade real voltou a 1', () => {
    const pdv = carregarPdv({ f12: true });
    const cache = { id: 777, nome: 'Produto cache', saldo_fiscal: 0, saldo_nao_fiscal: 1, estoque_atual: 1, reservado_fiscal: 0, reservado_nao_fiscal: 1 };
    const oficial = { ...cache, saldo_fiscal: 0, saldo_nao_fiscal: 1, estoque_atual: 1, reservado_fiscal: 0, reservado_nao_fiscal: 0 };

    const merged = pdv.mesclarProdutoCatalogoPdv(cache, oficial, { saldosOficiais: true });
    assert.equal(merged.reservado_nao_fiscal, 0);
    assert.equal(pdv.pdvSaldosDisponiveisMotorProduto(merged).estoque_atual, 1);
    assert.equal(pdv.pdvPodeIniciarInclusaoProduto(merged).sucesso, true);
  });
});
