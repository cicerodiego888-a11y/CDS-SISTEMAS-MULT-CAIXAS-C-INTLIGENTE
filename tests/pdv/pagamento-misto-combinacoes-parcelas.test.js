'use strict';

/**
 * Pagamento Misto do PDV — 6 combinações + parcelamento do cartão de crédito.
 *
 * Executa as funções reais do pdv.js (abrirPagamentoMisto, processarPagamentosMistosTEF,
 * processarPagamentoTEF) e o tefFluxoPagamento.js real, com DOM/jQuery mínimos e fetch capturado.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const PDV_SRC = fs.readFileSync(path.join(root, 'frontend/pdv/js/pdv.js'), 'utf8');
const TEF_FLUXO_SRC = fs.readFileSync(path.join(root, 'frontend/shared/js/tefFluxoPagamento.js'), 'utf8');

function extrairFuncao(src, nome) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${nome}\\s*\\(`).exec(src);
  assert.ok(m, `função ${nome} não encontrada no pdv.js`);
  const inicioCorpo = src.indexOf('{', src.indexOf(')', m.index));
  let profundidade = 0;
  for (let i = inicioCorpo; i < src.length; i += 1) {
    if (src[i] === '{') profundidade += 1;
    if (src[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`fim da função ${nome} não encontrado`);
}

const FUNCOES_PDV = [
  'normalizarFormaPagamentoTEF',
  'formaPagamentoUsaTEF',
  'formaPagamentoGravacaoFiscalPDV',
  'montarObjetoTEF',
  'processarPagamentoTEF',
  'processarPagamentosMistosTEF',
  'abrirPagamentoMisto'
].map((nome) => extrairFuncao(PDV_SRC, nome)).join('\n\n');

function criarDom() {
  const elementos = new Map();
  const filhos = new Map();

  function atributos(trecho) {
    const attrs = {};
    for (const m of trecho.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[m[1]] = m[2] ?? '';
    return attrs;
  }

  function limpar(containerId) {
    for (const id of filhos.get(containerId) || []) {
      limpar(id);
      elementos.delete(id);
    }
    filhos.delete(containerId);
  }

  function registrar(html, containerId) {
    const ids = [];
    for (const m of html.matchAll(/<(input|select|div|h3|button|small|label)\b([^>]*)>/g)) {
      const attrs = atributos(m[2]);
      if (!attrs.id) continue;
      const el = {
        id: attrs.id,
        tag: m[1],
        attrs,
        classes: new Set(String(attrs.class || '').split(/\s+/).filter(Boolean)),
        value: attrs.value ?? '',
        text: '',
        disabled: 'disabled' in attrs,
        handlers: {}
      };
      if (m[1] === 'select') {
        const fim = html.indexOf('</select>', m.index);
        const opcoes = [...html.slice(m.index, fim).matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)];
        el.opcoes = opcoes.map((o) => ({ value: o[1], rotulo: o[3].trim() }));
        el.value = (opcoes.find((o) => /\bselected\b/.test(o[2])) || opcoes[0])?.[1] ?? '';
      }
      elementos.set(attrs.id, el);
      ids.push(attrs.id);
    }
    filhos.set(containerId, ids);
  }

  function wrap(els) {
    const api = {
      length: els.length,
      val(v) {
        if (v === undefined) return els[0] ? els[0].value : undefined;
        els.forEach((e) => { e.value = String(v); });
        return api;
      },
      text(v) {
        if (v === undefined) return els[0] ? els[0].text : '';
        els.forEach((e) => { e.text = String(v); });
        return api;
      },
      html(h) {
        if (h === undefined) return '';
        els.forEach((e) => { limpar(e.id); registrar(String(h), e.id); });
        return api;
      },
      empty() { els.forEach((e) => limpar(e.id)); return api; },
      prop(nome, v) {
        if (v === undefined) return els[0] ? els[0][nome] : undefined;
        els.forEach((e) => { e[nome] = v; });
        return api;
      },
      addClass(c) { els.forEach((e) => e.classes.add(c)); return api; },
      removeClass(c) { els.forEach((e) => e.classes.delete(c)); return api; },
      hasClass(c) { return els.some((e) => e.classes.has(c)); },
      on(evento, fn) { els.forEach((e) => { (e.handlers[evento] ||= []).push(fn); }); return api; },
      trigger(evento) {
        els.forEach((e) => (e.handlers[evento] || []).forEach((fn) => fn.call(e, { type: evento })));
        return api;
      },
      each(fn) { els.forEach((e, i) => fn.call(e, i, e)); return api; },
      first() { return wrap(els.slice(0, 1)); },
      eq(i) { return wrap(els.slice(i, i + 1)); },
      data(chave) { return els[0] ? els[0].attrs[`data-${chave}`] : undefined; }
    };
    return api;
  }

  function $(seletor) {
    if (seletor && typeof seletor === 'object') return wrap([seletor]);
    if (seletor.startsWith('#')) {
      const el = elementos.get(seletor.slice(1));
      return wrap(el ? [el] : []);
    }
    if (seletor.startsWith('.')) {
      return wrap([...elementos.values()].filter((e) => e.classes.has(seletor.slice(1))));
    }
    return wrap([]);
  }

  elementos.set('modal-container', { id: 'modal-container', attrs: {}, classes: new Set(), handlers: {} });
  return { $, elementos };
}

function criarPdv({ totalVenda, tefHabilitado = true } = {}) {
  const dom = criarDom();
  const notificacoes = [];
  const chamadasTef = [];
  const silencioso = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const context = {
    console: silencioso,
    $: dom.$,
    jQuery: dom.$,
    document: { getElementById: (id) => dom.elementos.get(id) || null, activeElement: null },
    bootstrap: { Modal: class { show() {} hide() {} } },
    setTimeout: () => 0,
    clearTimeout() {},
    API_URL: '/api',
    localStorage: { getItem: () => 'token-teste' },
    showNotification: (mensagem, tipo = 'success') => notificacoes.push({ mensagem, tipo }),
    obterTotalVendaPDV: () => totalVenda,
    obterTefHabilitadoConfig: async () => tefHabilitado,
    pixAutomaticoHabilitado: async () => false,
    iniciarPixAutomaticoPDV() {},
    mostrarModalDecisaoFiscal() {},
    mostrarModalPixTefPDV: async () => {},
    fetch: async (url, opcoes = {}) => {
      const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
      if (url === '/api/tef/pagar') {
        chamadasTef.push(corpo);
        const n = chamadasTef.length;
        return {
          ok: true,
          status: 200,
          json: async () => ({ aprovado: true, transacao_id: `TEF-${n}`, nsu: `NSU-${n}`, autorizacao: `AUT-${n}` })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(TEF_FLUXO_SRC, context, { filename: 'tefFluxoPagamento.js' });
  vm.runInContext(
    `let pagamentosMistos = [];\nlet formaPagamentoSelecionadaPDV = null;\n${FUNCOES_PDV}`,
    context,
    { filename: 'pdv.js' }
  );
  context.abrirPagamentoMisto();

  const { $ } = dom;
  return {
    $,
    notificacoes,
    chamadasTef,
    combinacoes: () => dom.elementos.get('tipoPagamentoMisto').opcoes.filter((o) => o.value),
    selecionar(tipo) { $('#tipoPagamentoMisto').val(tipo).trigger('change'); },
    digitar(id, valor) { $(`#${id}`).val(valor).trigger('input'); },
    parcelas(n) { $('#parcelasCreditoMisto').val(n).trigger('change'); },
    confirmar() { $('#btnConfirmarPagamentoMisto').trigger('click'); },
    botaoDesabilitado: () => $('#btnConfirmarPagamentoMisto').prop('disabled') === true,
    pagamentos: () => JSON.parse(JSON.stringify(vm.runInContext('pagamentosMistos', context))),
    formaSelecionada: () => vm.runInContext('formaPagamentoSelecionadaPDV', context),
    processarTef: async () => JSON.parse(JSON.stringify(
      await vm.runInContext('processarPagamentosMistosTEF(pagamentosMistos)', context)
    ))
  };
}

function lancar({ totalVenda, combinacao, valores, parcelas }) {
  const pdv = criarPdv({ totalVenda });
  pdv.selecionar(combinacao);
  for (const [id, valor] of Object.entries(valores)) pdv.digitar(id, valor);
  if (parcelas !== undefined) pdv.parcelas(parcelas);
  return pdv;
}

describe('Pagamento Misto do PDV — combinações', () => {
  it('oferece exatamente as 6 combinações, sem repetir a mesma forma', () => {
    const pdv = criarPdv({ totalVenda: 100 });
    assert.deepEqual(pdv.combinacoes().map((o) => o.value), [
      'dinheiro_pix', 'dinheiro_debito', 'dinheiro_credito', 'pix_debito', 'pix_credito', 'debito_credito'
    ]);
    assert.deepEqual(pdv.combinacoes().map((o) => o.rotulo), [
      'Dinheiro + Pix',
      'Dinheiro + Cartão de Débito',
      'Dinheiro + Cartão de Crédito',
      'Pix + Cartão de Débito',
      'Pix + Cartão de Crédito',
      'Cartão de Débito + Cartão de Crédito'
    ]);
    for (const { value } of pdv.combinacoes()) {
      pdv.selecionar(value);
      const formas = [];
      pdv.$('.pagamento-misto-input').each(function () { formas.push(pdv.$(this).data('forma')); });
      assert.equal(formas.length, 2, `${value}: dois componentes`);
      assert.notEqual(formas[0], formas[1], `${value}: formas distintas`);
    }
  });

  it('campo de parcelas aparece somente quando a combinação tem crédito', () => {
    const pdv = criarPdv({ totalVenda: 100 });
    for (const tipo of ['dinheiro_pix', 'dinheiro_debito', 'pix_debito']) {
      pdv.selecionar(tipo);
      assert.equal(pdv.$('#parcelasCreditoMisto').length, 0, `${tipo}: sem parcelas`);
    }
    for (const tipo of ['dinheiro_credito', 'pix_credito', 'debito_credito']) {
      pdv.selecionar(tipo);
      assert.equal(pdv.$('#parcelasCreditoMisto').length, 1, `${tipo}: com parcelas`);
      const opcoes = pdv.$('#parcelasCreditoMisto').prop('opcoes').filter((o) => o.value).map((o) => o.rotulo);
      assert.deepEqual(opcoes, Array.from({ length: 12 }, (_, i) => `${i + 1}x`), `${tipo}: 1x a 12x`);
      assert.equal(pdv.$('#parcelasCreditoMisto').val(), '1', `${tipo}: padrão 1x`);
    }
  });
});

describe('Pagamento Misto do PDV — fluxo por combinação até o TEF', () => {
  const CENARIOS = [
    {
      nome: 'TESTE 1 — Dinheiro + Pix',
      totalVenda: 100, combinacao: 'dinheiro_pix', valores: { pgDinheiro: 40, pgPix: 60 },
      esperado: [{ forma_pagamento: 'dinheiro', valor: 40 }, { forma_pagamento: 'pix', valor: 60 }],
      tef: [{ tipo: 'pix_tef', valor: 60, parcelas: 1 }]
    },
    {
      nome: 'TESTE 2 — Dinheiro + Débito',
      totalVenda: 100, combinacao: 'dinheiro_debito', valores: { pgDinheiro: 30, pgDebito: 70 },
      esperado: [{ forma_pagamento: 'dinheiro', valor: 30 }, { forma_pagamento: 'cartao_debito', valor: 70 }],
      tef: [{ tipo: 'cartao_debito', valor: 70, parcelas: 1 }]
    },
    {
      nome: 'TESTE 3 — Dinheiro + Crédito 1x',
      totalVenda: 100, combinacao: 'dinheiro_credito', valores: { pgDinheiro: 20, pgCredito: 80 }, parcelas: 1,
      esperado: [{ forma_pagamento: 'dinheiro', valor: 20 }, { forma_pagamento: 'cartao_credito', valor: 80, parcelas: 1 }],
      tef: [{ tipo: 'cartao_credito', valor: 80, parcelas: 1 }]
    },
    {
      nome: 'TESTE 4 — Pix + Débito',
      totalVenda: 500, combinacao: 'pix_debito', valores: { pgPix: 200, pgDebito: 300 },
      esperado: [{ forma_pagamento: 'pix', valor: 200 }, { forma_pagamento: 'cartao_debito', valor: 300 }],
      tef: [{ tipo: 'pix_tef', valor: 200, parcelas: 1 }, { tipo: 'cartao_debito', valor: 300, parcelas: 1 }]
    },
    {
      nome: 'TESTE 5 — Pix + Crédito 3x',
      totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 200, pgCredito: 300 }, parcelas: 3,
      esperado: [{ forma_pagamento: 'pix', valor: 200 }, { forma_pagamento: 'cartao_credito', valor: 300, parcelas: 3 }],
      tef: [{ tipo: 'pix_tef', valor: 200, parcelas: 1 }, { tipo: 'cartao_credito', valor: 300, parcelas: 3 }],
      resumo: 'Crédito: R$ 300,00 — 3x de R$ 100,00'
    },
    {
      nome: 'TESTE 6 — Débito + Crédito 6x',
      totalVenda: 1000, combinacao: 'debito_credito', valores: { pgDebito: 400, pgCredito: 600 }, parcelas: 6,
      esperado: [{ forma_pagamento: 'cartao_debito', valor: 400 }, { forma_pagamento: 'cartao_credito', valor: 600, parcelas: 6 }],
      tef: [{ tipo: 'cartao_debito', valor: 400, parcelas: 1 }, { tipo: 'cartao_credito', valor: 600, parcelas: 6 }],
      resumo: 'Crédito: R$ 600,00 — 6x de R$ 100,00'
    }
  ];

  for (const cenario of CENARIOS) {
    it(cenario.nome, async () => {
      const pdv = lancar(cenario);
      assert.equal(pdv.botaoDesabilitado(), false, 'confirmação liberada com soma exata');
      assert.equal(pdv.$('#totalFalta').text(), 'R$ 0,00');
      if (cenario.resumo) assert.equal(pdv.$('#resumoParcelasCreditoMisto').text(), cenario.resumo);

      pdv.confirmar();
      assert.deepEqual(pdv.pagamentos(), cenario.esperado, 'pagamentos[] individuais');
      assert.equal(pdv.formaSelecionada(), 'misto');
      for (const pagamento of pdv.pagamentos()) {
        if (pagamento.forma_pagamento !== 'cartao_credito') {
          assert.equal('parcelas' in pagamento, false, `${pagamento.forma_pagamento} não recebe parcelas`);
        }
      }

      const processados = await pdv.processarTef();
      assert.deepEqual(
        pdv.chamadasTef.map(({ tipo, valor, parcelas }) => ({ tipo, valor, parcelas })),
        cenario.tef,
        'corpo de POST /api/tef/pagar'
      );
      assert.deepEqual(
        processados.map(({ forma_pagamento, valor, parcelas }) => ({ forma_pagamento, valor, ...(parcelas ? { parcelas } : {}) })),
        cenario.esperado,
        'pagamentos processados mantêm os componentes'
      );
    });
  }
});

describe('Pagamento Misto do PDV — parcelamento do crédito', () => {
  for (const parcelas of [1, 3, 6, 12]) {
    it(`Crédito R$ 300 em ${parcelas}x chega ao TEF com valor 300 e ${parcelas} parcelas`, async () => {
      const pdv = lancar({
        totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 200, pgCredito: 300 }, parcelas
      });
      const valorParcela = (300 / parcelas).toFixed(2).replace('.', ',');
      assert.equal(pdv.$('#resumoParcelasCreditoMisto').text(), `Crédito: R$ 300,00 — ${parcelas}x de R$ ${valorParcela}`);
      pdv.confirmar();
      assert.deepEqual(pdv.pagamentos()[1], { forma_pagamento: 'cartao_credito', valor: 300, parcelas });
      await pdv.processarTef();
      const credito = pdv.chamadasTef.find((c) => c.tipo === 'cartao_credito');
      assert.equal(credito.valor, 300, 'valor enviado é o total do crédito, não o da parcela');
      assert.equal(credito.parcelas, parcelas);
    });
  }

  it('TESTE DE SOMA — venda 500, Pix 200 + Crédito 300 em 3x', () => {
    const pdv = lancar({ totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 200, pgCredito: 300 }, parcelas: 3 });
    assert.equal(pdv.$('#totalInformado').text(), 'R$ 500,00');
    assert.equal(pdv.$('#totalFalta').text(), 'R$ 0,00');
    assert.equal(pdv.$('#resumoParcelasCreditoMisto').text(), 'Crédito: R$ 300,00 — 3x de R$ 100,00');
    pdv.confirmar();
    const credito = pdv.pagamentos().find((p) => p.forma_pagamento === 'cartao_credito');
    assert.equal(credito.valor, 300);
    assert.equal(credito.parcelas, 3);
    assert.equal(pdv.pagamentos().reduce((s, p) => s + p.valor, 0), 500);
  });
});

describe('Pagamento Misto do PDV — validações', () => {
  it('VALOR INCOMPLETO — 400 de 500 não permite confirmar', () => {
    const pdv = lancar({ totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 200, pgCredito: 200 }, parcelas: 3 });
    assert.equal(pdv.$('#totalInformado').text(), 'R$ 400,00');
    assert.equal(pdv.$('#totalFalta').text(), 'R$ 100,00');
    assert.equal(pdv.botaoDesabilitado(), true);
    pdv.confirmar();
    assert.deepEqual(pdv.pagamentos(), [], 'nenhum pagamento montado');
    assert.equal(pdv.formaSelecionada(), null);
  });

  it('VALOR EXCEDENTE — 600 de 500 não permite confirmar', () => {
    const pdv = lancar({ totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 300, pgCredito: 300 }, parcelas: 3 });
    assert.equal(pdv.$('#totalInformado').text(), 'R$ 600,00');
    assert.equal(pdv.botaoDesabilitado(), true);
    pdv.confirmar();
    assert.deepEqual(pdv.pagamentos(), []);
  });

  it('CRÉDITO SEM PARCELAS — bloqueia e pede a quantidade de parcelas', () => {
    const pdv = lancar({ totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 200, pgCredito: 300 }, parcelas: '' });
    assert.equal(pdv.botaoDesabilitado(), true);
    assert.match(pdv.$('#alertaPagamentoMisto').text(), /quantidade de parcelas/);
    assert.equal(pdv.$('#alertaPagamentoMisto').hasClass('d-none'), false);
    pdv.confirmar();
    assert.deepEqual(pdv.pagamentos(), []);
    assert.ok(pdv.notificacoes.some((n) => n.tipo === 'warning' && /quantidade de parcelas/.test(n.mensagem)));
  });

  it('crédito com valor zero não exige parcelas', () => {
    const pdv = lancar({ totalVenda: 500, combinacao: 'pix_credito', valores: { pgPix: 500, pgCredito: 0 }, parcelas: '' });
    assert.equal(pdv.botaoDesabilitado(), false);
    pdv.confirmar();
    assert.deepEqual(pdv.pagamentos(), [{ forma_pagamento: 'pix', valor: 500 }]);
  });
});
