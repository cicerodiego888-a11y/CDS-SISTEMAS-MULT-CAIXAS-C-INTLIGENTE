/**
 * CE-UX-01 — Ignorar item na conferência de produtos.
 * Executar: node --test tests/miip/ce-ux-01-ignorar-item.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const ler = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const JS_INTELIGENTE = ler('frontend/erp/js/miip-central-revisao-inteligente.js');
const JS_REVISAO = ler('frontend/erp/js/miip-central-revisao.js');

function criarJquery(registro) {
  function no(chave) {
    const alvo = {
      length: 1,
      html(v) {
        if (v === undefined) return registro[chave] || '';
        registro[chave] = String(v);
        return proxy;
      },
      text(v) {
        if (v === undefined) return registro[`${chave}:text`] || '';
        registro[`${chave}:text`] = String(v);
        return proxy;
      },
      append(v) {
        registro[chave] = (registro[chave] || '') + String(v);
        return proxy;
      },
      is() { return false; },
      hasClass() { return false; },
      data() { return undefined; },
      val() { return ''; }
    };
    const proxy = new Proxy(alvo, {
      get(t, k) {
        if (typeof k === 'symbol' || k === 'then') return undefined;
        return k in t ? t[k] : () => proxy;
      }
    });
    return proxy;
  }
  const $ = (sel) => no(typeof sel === 'string' ? sel : '[objeto]');
  $.ajax = () => Promise.resolve({ sucesso: true });
  return $;
}

function criarTela() {
  const registro = {};
  const chamadas = [];
  const notificacoes = [];
  const elementos = {
    miipCentralConversoes: { innerHTML: '' },
    miipCentralAcoesBarra: { hidden: false },
    miipCentralBtnIgnorar: {
      disabled: false,
      className: 'btn',
      getAttribute() { return null; },
      setAttribute() {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    }
  };

  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    setImmediate,
    structuredClone,
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {}
    },
    showNotification: (msg, tipo) => notificacoes.push({ msg, tipo }),
    bootstrap: {
      Modal: class {
        show() {}
        hide() {}
        static getOrCreateInstance() { return new this(); }
        static getInstance() { return null; }
      }
    },
    fetch: async (url, init = {}) => {
      const corpoReq = init.body ? JSON.parse(init.body) : null;
      chamadas.push({ url, metodo: init.method || 'GET', corpo: corpoReq });
      let corpo = {};
      if (/\/revisar\/itens\/\d+\/decisao$/.test(url) && init.method === 'POST') {
        corpo = {
          sucesso: true,
          progresso: { total: 3, concluidos: 1, pendentes: 2, itemAtual: 1, primeiroPendente: 1 }
        };
      } else if (/\/revisar\/conversoes$/.test(url)) {
        corpo = { linhas: [], bloqueia_efetivacao: false };
      }
      return { ok: true, status: 200, json: async () => corpo };
    }
  };
  context.document = {
    getElementById: (id) => elementos[id] || null,
    querySelector: () => null,
    addEventListener() {}
  };
  context.window = context;
  context.$ = criarJquery(registro);
  context.jQuery = context.$;
  vm.createContext(context);
  vm.runInContext(JS_INTELIGENTE, context, { filename: 'miip-central-revisao-inteligente.js' });
  vm.runInContext(JS_REVISAO, context, { filename: 'miip-central-revisao.js' });
  return { context, registro, chamadas, notificacoes, elementos };
}

function dadosComPendencias() {
  const itens = [
    { produto_nome: 'LUVA DE VAQUETA NATURAL G', unidade: 'PAR', quantidade: 10, preco_unitario: 12 },
    { produto_nome: 'CAPACETE SEGURANCA', unidade: 'UN', quantidade: 2, preco_unitario: 40 },
    { produto_nome: 'OCULOS PROTECAO', unidade: 'UN', quantidade: 5, preco_unitario: 8 }
  ];
  const prod = { id: 10, nome: 'Luva Vaqueta G', unidade: 'PAR', ativo: 1 };
  return {
    produtos: [prod],
    dadosImportacao: {
      fornecedor: 'EPI Teste',
      fornecedor_cnpj: '12345678000199',
      itens,
      miip_importacao: {
        usarMiipImportacaoXML: true,
        resumo: { totalItens: 3, identificadosAutomaticamente: 0, precisamConfirmacao: 2, precisamCadastro: 1 },
        resultados: [
          {
            indice: 0,
            precisaConfirmacao: true,
            produtoEncontrado: prod,
            score: 88,
            produtoXML: itens[0],
            candidatos: [{ produtoId: 10, score: 88, produto: prod }],
            acao: 'sugerir'
          },
          {
            indice: 1,
            precisaCadastro: true,
            precisaConfirmacao: false,
            produtoEncontrado: null,
            score: 0,
            produtoXML: itens[1],
            candidatos: [],
            acao: 'criar_novo'
          },
          {
            indice: '2',
            precisaConfirmacao: true,
            produtoEncontrado: { id: 11, nome: 'Oculos', ativo: 1 },
            score: 70,
            produtoXML: itens[2],
            candidatos: [],
            acao: 'sugerir'
          }
        ]
      }
    }
  };
}

const esperar = () => new Promise((r) => setImmediate(r));

describe('CE-UX-01 — Ignorar item', () => {
  test('ignorarAtual persiste IGNORAR, atualiza contadores e avança', async () => {
    const tela = criarTela();
    const { produtos, dadosImportacao } = dadosComPendencias();
    tela.context.MiipCentralRevisao.iniciar({
      apiUrl: '/api',
      dadosImportacao,
      produtos,
      documento: { id: 501 },
      onConcluir() {},
      onCancelar() {}
    });
    for (let i = 0; i < 6; i += 1) await esperar();

    const api = tela.context.MiipCentralRevisao._test;
    const antes = api.obterEstado();
    assert.ok(antes?.sessao);
    assert.equal(api.contarAbertas(antes.sessao), 3);
    assert.equal(antes.sessao.ignoradas.length, 0);

    api.ignorarAtual();
    for (let i = 0; i < 8; i += 1) await esperar();

    const depois = api.obterEstado();
    assert.ok(depois.sessao.ignoradas.some((v) => Number(v) === 0));
    assert.equal(depois.sessao.itens[0].miip_revisao_status, 'ignorado');
    assert.equal(api.contarAbertas(depois.sessao), 2);
    assert.ok(
      tela.chamadas.some((c) => c.metodo === 'POST' && c.corpo?.decisao === 'IGNORAR'),
      'deve POST IGNORAR'
    );
    assert.ok(
      tela.notificacoes.some((n) => /Item ignorado/i.test(n.msg)),
      'deve notificar sucesso'
    );
  });

  test('pendenciaAberta trata indice string/number de forma consistente', () => {
    const tela = criarTela();
    const api = tela.context.MiipCentralRevisao._test;
    const sessao = {
      resolvidas: ['2'],
      ignoradas: [0],
      pendencias: [{ indice: 0 }, { indice: '1' }, { indice: 2 }]
    };
    assert.equal(api.pendenciaAberta(sessao, sessao.pendencias[0]), false);
    assert.equal(api.pendenciaAberta(sessao, sessao.pendencias[1]), true);
    assert.equal(api.pendenciaAberta(sessao, sessao.pendencias[2]), false);
  });

  test('ignorar com fase final informa conversão/conferência, sem mutar estado', async () => {
    const tela = criarTela();
    const api = tela.context.MiipCentralRevisao._test;
    api.definirEstado({
      _persistindoDecisao: false,
      sessao: {
        fase: 'final',
        pendencias: [{ indice: 0 }],
        resolvidas: [0],
        ignoradas: [],
        itens: [{ produto_nome: 'X' }],
        indiceAtual: 0,
        resumo: {}
      },
      opcoes: { documento: { id: 1 }, apiUrl: '/api', obterUsuario: () => null }
    });

    api.ignorarAtual();
    await esperar();

    const st = api.obterEstado();
    assert.equal(st.sessao.ignoradas.length, 0);
    assert.ok(tela.notificacoes.some((n) => /já foi concluída/i.test(n.msg)));
  });

  test('atalhos Enter/F2/F3/Tab/Esc permanecem no fonte', () => {
    const src = JS_REVISAO;
    assert.match(src, /event\.key === 'Enter'[\s\S]{0,160}confirmarAtual\(\)/);
    assert.match(src, /event\.key === 'F2'[\s\S]{0,80}abrirBuscaProduto\(\)/);
    assert.match(src, /event\.key === 'F3'[\s\S]{0,80}cadastrarNovo\(\)/);
    assert.match(src, /event\.key === 'Escape'[\s\S]{0,80}cancelarRevisao\(\)/);
    assert.match(src, /event\.key === 'Tab'[\s\S]{0,160}proximaAberta\(/);
    assert.match(src, /click\.miipCentralIgnorar/);
    assert.match(src, /aria-disabled/);
  });
});
