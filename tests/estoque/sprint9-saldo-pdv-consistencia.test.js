/**
 * Sprint 9 — Saldo no PDV e consistência do estoque entre telas.
 * O PDV só responde "há quantidade disponível (F + NF − comprometido) para inserir?";
 * a distribuição continua sendo do motor (distribuidorEstoqueVenda.js, não alterado).
 *
 * Executar: node --test tests/estoque/sprint9-saldo-pdv-consistencia.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const pdvSrc = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const helpersSrc = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/modoFiscalHelpers.js'), 'utf8');
const erpProdutosSrc = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
const rotaProdutosSrc = fs.readFileSync(path.join(ROOT, 'backend/rotas/produtos.js'), 'utf8');
const pagSrc = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');

const { distribuirItensVendaComValorFiscalEfetivo } = require('../../backend/services/distribuidorEstoqueVenda');
const { saldosDisponiveisMotorFxNf } = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const { prepararEntradasMotorComTransferenciaPdv } = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');

const PRECO = 5.39;

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Marcador não encontrado: ${startMarker}`);
  return src.slice(start, end);
}

let proximoId = 9000;
function produto(fiscal, naoFiscal, { itemFiscal = 1, controla = 1, resF = 0, resNF = 0 } = {}) {
  return {
    id: proximoId++,
    nome: 'Produto S9',
    categoria: 'Açougue',
    saldo_fiscal: fiscal,
    saldo_nao_fiscal: naoFiscal,
    estoque_atual: fiscal + naoFiscal,
    reservado_fiscal: resF,
    reservado_nao_fiscal: resNF,
    item_fiscal: itemFiscal,
    controla_estoque: controla
  };
}

/** Mesmo caminho do pré-cálculo/finalização (VendaPagamentoService). */
function motor(p, qtd, { f12, semEstoque = false }) {
  const disp = saldosDisponiveisMotorFxNf(p);
  const s = saldosParaDistribuicaoVenda(p, qtd, disp.saldoFiscal, disp.saldoNaoFiscal);
  const subtotal = Number((qtd * PRECO).toFixed(2));
  const prep = prepararEntradasMotorComTransferenciaPdv([{
    item: { produto_id: p.id, quantidade: qtd, preco_unitario: PRECO, subtotal, unidade: 'UN' },
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

/** Baixa real (reduzirEstoqueDistribuido) aplicada ao objeto do produto (espelha o UPDATE saldo - ?). */
async function baixar(p, qF, qNF) {
  const chamadas = [];
  const fn = new Function('db', 'require', 'reduzirEstoqueComFEFO', `
    ${extract(pagSrc, 'function reduzirEstoqueDistribuido(', 'function atualizarStatusPagamentoVenda')}
    return reduzirEstoqueDistribuido;
  `)(
    { get: (_sql, _params, cb) => cb(null, { controla_estoque: p.controla_estoque }) },
    () => ({ produtoControlaEstoque: (row) => Number(row.controla_estoque) !== 0 }),
    (_vid, _pid, qtd, itemFiscal, cb) => { chamadas.push({ qtd, itemFiscal }); cb(null); }
  );
  await new Promise((resolve, reject) => fn(1, p.id, qF, qNF, (e) => (e ? reject(e) : resolve())));
  const depois = { ...p };
  for (const c of chamadas) {
    if (c.itemFiscal === 1) depois.saldo_fiscal -= c.qtd;
    else depois.saldo_nao_fiscal -= c.qtd;
  }
  depois.estoque_atual = depois.saldo_fiscal + depois.saldo_nao_fiscal;
  return depois;
}

/**
 * Carrega as funções reais de inclusão/saldo/catálogo do PDV (pdv.js + modoFiscalHelpers.js).
 * F12 controla pdvModoFiscalAtivo e o modo de visualização lido pelos helpers.
 */
function carregarPdv({ f12, semEstoque = false }) {
  const localStorage = { getItem: (k) => (k === 'pdv_modo_fiscal_ativo' ? (f12 ? '1' : '0') : null) };
  const window = {};
  return new Function('window', 'localStorage', `
    let produtosDisponiveis = [];
    let catalogoVersaoPdvAtual = null;
    function sincronizarProdutosDisponiveisGlobal() { window.produtosDisponiveis = produtosDisponiveis; }
    function normalizarProdutoPdvLista(l) { return l; }
    function pdvProdutoPermitidoNoModoAtual() { return true; }
    function pdvModoFiscalAtivo() { return ${f12 === true}; }
    function pdvPermitirVendaSemEstoque() { return ${semEstoque === true}; }
    function formatarQuantidadePdv(n) { return String(n); }
    ${extract(helpersSrc, 'function modoFiscalQueryParam', 'function obterEstoqueExibicaoSimplesProduto')}
    ${extract(pdvSrc, 'function pdvTotalSaldosProduto', 'let recarregarCatalogoPdvInflight')}
    ${extract(pdvSrc, 'function pdvResolverSaldosProduto', 'function round3TransferenciaPdv')}
    ${extract(pdvSrc, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    ${extract(pdvSrc, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
    ${extract(pdvSrc, 'function validarEstoqueVenda', 'function pdvNotificarBloqueioInclusaoProduto')}
    return {
      setCatalogo(l) { produtosDisponiveis = l; sincronizarProdutosDisponiveisGlobal(); },
      catalogo() { return produtosDisponiveis; },
      upsertProdutoNoCatalogoPdv,
      pdvPodeIniciarInclusaoProduto,
      pdvValidarEstoqueVenda,
      pdvResolverSaldosProduto
    };
  `)(window, localStorage);
}

function mensagemBloqueio(p, r) {
  return r.semSaldoTotal ? r.mensagem : r.mensagem.replace('Saldo insuficiente.', `Saldo insuficiente para ${p.nome}.`);
}

function pdvInsere(p, qtd, ctx) {
  const pdv = carregarPdv(ctx);
  pdv.setCatalogo([p]);
  const inicio = pdv.pdvPodeIniciarInclusaoProduto(p);
  if (!inicio.sucesso) return { ok: false, mensagem: mensagemBloqueio(p, inicio) };
  const v = pdv.pdvValidarEstoqueVenda(p, qtd);
  if (!v.sucesso && !v.confirmarSemEstoque) return { ok: false, mensagem: mensagemBloqueio(p, v) };
  return { ok: true, confirmarSemEstoque: v.confirmarSemEstoque === true };
}

const qtds = (r) => [r.itens[0].quantidade_fiscal, r.itens[0].quantidade_nao_fiscal];
const F12 = [{ f12: true }, { f12: false }];
const rot = (ctx) => `F12 ${ctx.f12 ? 'ON' : 'OFF'}`;

describe('Sprint 9 — PDV: inclusão usa disponível total F + NF (independe do F12)', () => {
  for (const ctx of F12) {
    it(`F0 NF1 comprometido 0 Q1 (${rot(ctx)}): entra no PDV, sem "Disponível: 0"; motor → 0F + 1NF`, async () => {
      const p = produto(0, 1);
      const inc = pdvInsere(p, 1, ctx);
      assert.equal(inc.ok, true, inc.mensagem);
      assert.equal(inc.confirmarSemEstoque, false);
      const r = motor(p, 1, ctx);
      assert.equal(r.sucesso, true);
      assert.deepEqual(qtds(r), [0, 1]);
      const d = await baixar(p, ...qtds(r));
      assert.deepEqual([d.saldo_fiscal, d.saldo_nao_fiscal], [0, 0]);
    });

    it(`F0 NF1 item_fiscal=0 Q1 (${rot(ctx)}): entra; motor → 0F + 1NF`, () => {
      const p = produto(0, 1, { itemFiscal: 0 });
      assert.equal(pdvInsere(p, 1, ctx).ok, true);
      assert.deepEqual(qtds(motor(p, 1, ctx)), [0, 1]);
    });

    it(`F0 NF0 Q1 (${rot(ctx)}): bloqueado (venda sem estoque desativada)`, () => {
      const p = produto(0, 0);
      const inc = pdvInsere(p, 1, ctx);
      assert.equal(inc.ok, false);
      assert.match(inc.mensagem, /não tem saldo/);
      assert.equal(motor(p, 1, ctx).sucesso, false);
    });

    it(`F1 NF0 Q1 (${rot(ctx)}): entra; motor → 1F + 0NF; baixa F 1→0`, async () => {
      const p = produto(1, 0);
      assert.equal(pdvInsere(p, 1, ctx).ok, true);
      const r = motor(p, 1, ctx);
      assert.deepEqual(qtds(r), [1, 0]);
      const d = await baixar(p, ...qtds(r));
      assert.deepEqual([d.saldo_fiscal, d.saldo_nao_fiscal], [0, 0]);
    });

    it(`F1 NF1 Q2 (${rot(ctx)}): entra; motor → 1F + 1NF; baixa F 0 NF 0`, async () => {
      const p = produto(1, 1);
      assert.equal(pdvInsere(p, 2, ctx).ok, true);
      const r = motor(p, 2, ctx);
      assert.deepEqual(qtds(r), [1, 1]);
      const d = await baixar(p, ...qtds(r));
      assert.deepEqual([d.saldo_fiscal, d.saldo_nao_fiscal, d.estoque_atual], [0, 0, 0]);
    });

    it(`F0 NF1 com a unidade NF comprometida (${rot(ctx)}): "Disponível: 0" é o bloqueio correto (E-Comprometido)`, () => {
      const p = produto(0, 1, { resNF: 1 });
      const inc = pdvInsere(p, 1, ctx);
      assert.equal(inc.ok, false);
      assert.match(inc.mensagem, /Saldo insuficiente para Produto S9\.\s+Disponível: 0/);
      assert.equal(motor(p, 1, ctx).sucesso, false);
    });
  }
});

describe('Sprint 9 — PDV: catálogo após baixa (1 → 0, nunca 1 → 1)', () => {
  it('GET /produtos/:id (saldos oficiais) com 0/0 substitui saldo antigo positivo do catálogo', () => {
    const pdv = carregarPdv({ f12: false });
    const p = produto(1, 1);
    pdv.setCatalogo([p]);
    pdv.upsertProdutoNoCatalogoPdv({ ...p, saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0 }, { saldosOficiais: true });
    const c = pdv.catalogo()[0];
    assert.deepEqual([c.saldo_fiscal, c.saldo_nao_fiscal, c.estoque_atual], [0, 0, 0]);
  });

  it('busca F1/MIB (não oficial) com saldos zerados continua sem sobrescrever o catálogo', () => {
    const pdv = carregarPdv({ f12: false });
    const p = produto(1, 1);
    pdv.setCatalogo([p]);
    pdv.upsertProdutoNoCatalogoPdv({ ...p, saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0 });
    const c = pdv.catalogo()[0];
    assert.deepEqual([c.saldo_fiscal, c.saldo_nao_fiscal], [1, 1]);
  });

  it('hidratação garantirProdutoNoCatalogoPdv usa saldosOficiais no GET /produtos/:id', () => {
    const fn = extract(pdvSrc, 'async function garantirProdutoNoCatalogoPdv', 'function inicializarSincronizacaoCatalogoPdv');
    assert.match(fn, /\/produtos\/\$\{id\}\?modo_fiscal=/);
    assert.match(fn, /upsertProdutoNoCatalogoPdv\(completo,\s*\{\s*saldosOficiais:\s*true\s*\}\)/);
  });

  for (const ctx of F12) {
    it(`venda repetida da última unidade (${rot(ctx)}): 1 → 0 e a 2ª inclusão é bloqueada`, async () => {
      const pdv = carregarPdv(ctx);
      let p = produto(1, 0);
      pdv.setCatalogo([p]);
      assert.equal(pdv.pdvPodeIniciarInclusaoProduto(p).sucesso, true);
      const r = motor(p, 1, ctx);
      assert.deepEqual(qtds(r), [1, 0]);
      p = await baixar(p, ...qtds(r));
      assert.equal(p.saldo_fiscal, 0);
      pdv.upsertProdutoNoCatalogoPdv(p, { saldosOficiais: true });
      const noCatalogo = pdv.catalogo()[0];
      assert.equal(pdv.pdvResolverSaldosProduto(noCatalogo).estoque_atual, 0);
      assert.equal(pdv.pdvPodeIniciarInclusaoProduto(noCatalogo).sucesso, false);
      assert.equal(motor(p, 1, ctx).sucesso, false);
    });
  }
});

describe('Sprint 9 — Lista de Produtos × modal Ajustar Estoque: fonte única', () => {
  it('GET / (lista) e GET /:id (modal) normalizam saldos pela mesma função a partir de produtos.saldo_*', () => {
    const norm = extract(rotaProdutosSrc, 'function normalizarProdutoResposta', 'const base = {');
    assert.match(norm, /const estoqueAtual = saldoFiscal \+ saldoNaoFiscal;/);
    const trecho = (marcador) => rotaProdutosSrc.slice(rotaProdutosSrc.indexOf(marcador), rotaProdutosSrc.indexOf(marcador) + 4000);
    assert.match(trecho("router.get('/', (req, res) => {"), /normalizarProdutoResposta\(/);
    assert.match(trecho("router.get('/:id', (req, res) => {"), /normalizarProdutoResposta\(/);
  });

  function carregarListaErp(servidor) {
    const chamadas = [];
    const renders = [];
    const document = { getElementById: () => null };
    const $ = (sel) => ({ length: /buscaProduto|categorias-container|produtos-tbody/.test(sel) ? 1 : 0, is: () => false });
    $.ajax = (opts) => {
      chamadas.push(opts.url);
      const lista = servidor().map((p) => ({ ...p }));
      return Promise.resolve().then(() => { opts.success(lista); return lista; });
    };
    const window = {};
    const api = new Function('window', 'document', '$', 'renders', `
      const API_URL = '/api';
      const currentPage = 'produtos';
      function modoFiscalParamGestaoProdutosLocal() { return '0'; }
      function renderProdutos(l) { renders.push(l); }
      function atualizarListagemProdutosSemRemontarShell(l) { window.produtosList = l; renders.push(l); }
      ${extract(erpProdutosSrc, 'function obterSessaoCatalogoProdutos', 'function atualizarProdutoNoCatalogoLocal')}
      ${extract(erpProdutosSrc, 'function loadProdutos', 'let inflightListagemProdutosModoFiscal')}
      return { loadProdutos, agendarRevalidacaoSaldosCatalogoProdutos };
    `)(window, document, $, renders);
    return { api, window, chamadas, renders };
  }

  it('retorno/reclique à lista revalida saldos: venda no PDV (F1 NF2 → F0 NF1) aparece na lista como no modal', async () => {
    let banco = [{ id: 611, nome: 'Arroz', saldo_fiscal: 1, saldo_nao_fiscal: 2, estoque_atual: 3 }];
    const erp = carregarListaErp(() => banco);
    await erp.api.loadProdutos();
    assert.equal(erp.window.produtosList[0].estoque_atual, 3);

    banco = [{ id: 611, nome: 'Arroz', saldo_fiscal: 0, saldo_nao_fiscal: 1, estoque_atual: 1 }];
    await erp.api.loadProdutos();
    await erp.api.agendarRevalidacaoSaldosCatalogoProdutos();
    await new Promise((r) => setTimeout(r, 5));

    const naLista = erp.window.produtosList[0];
    const noModal = banco[0];
    assert.deepEqual(
      [naLista.saldo_fiscal, naLista.saldo_nao_fiscal, naLista.estoque_atual],
      [noModal.saldo_fiscal, noModal.saldo_nao_fiscal, noModal.estoque_atual]
    );
    assert.deepEqual([naLista.saldo_fiscal, naLista.saldo_nao_fiscal, naLista.estoque_atual], [0, 1, 1]);
    assert.ok(erp.chamadas.length >= 2, 'revalidação usa o mesmo GET /produtos da lista');
    assert.ok(erp.chamadas.every((u) => u === '/api/produtos?modo_fiscal=0'));
  });

  it('após venda F1 NF1 Q2 a lista mostra 0/0/0', async () => {
    const p = produto(1, 1);
    let banco = [p];
    const erp = carregarListaErp(() => banco);
    await erp.api.loadProdutos();
    const r = motor(p, 2, { f12: false });
    banco = [await baixar(p, ...qtds(r))];
    await erp.api.loadProdutos();
    await erp.api.agendarRevalidacaoSaldosCatalogoProdutos();
    await new Promise((res) => setTimeout(res, 5));
    const l = erp.window.produtosList[0];
    assert.deepEqual([l.saldo_fiscal, l.saldo_nao_fiscal, l.estoque_atual], [0, 0, 0]);
  });
});

describe('Sprint 9 — escopo', () => {
  it('motor central e VENDA SEM ESTOQUE local permanecem como no Sprint 8', () => {
    const motorSrc = fs.readFileSync(path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');
    assert.match(motorSrc, /comprometidoMotorFxNf/);
    assert.match(pdvSrc, /distribuicaoOficialNecessaria: true/);
  });
});
