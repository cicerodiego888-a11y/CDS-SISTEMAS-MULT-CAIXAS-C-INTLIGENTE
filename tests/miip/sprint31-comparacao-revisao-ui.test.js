'use strict';

/**
 * Sprint 3.1 — a revisão MIIP aberta por Compras ou pela Central carrega o módulo de comparação
 * (miip-central-revisao-inteligente.js) antes da tela e mostra os campos comparados.
 * Sem o módulo, a tela avisa que a comparação não foi feita em vez de exibir comparação vazia.
 *
 * Usa o carregador lazy real de app.js; os dois scripts da revisão são executados na ordem do manifesto.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '../..');
const URL_INTELIGENTE = '/erp/js/miip-central-revisao-inteligente.js';
const URL_REVISAO = '/erp/js/miip-central-revisao.js';
const EXECUTADOS = new Set([URL_INTELIGENTE, URL_REVISAO]);

function fonte(url) {
  return fs.readFileSync(path.join(root, 'frontend', ...url.replace(/^\//, '').split('/')), 'utf8');
}

/**
 * @param {Object} [opcoes]
 * @param {string} [opcoes.falhaDownload] - URL que dispara onerror
 * @param {string} [opcoes.semExecutar] - URL que "carrega" mas não registra nada
 */
function criarErp(opcoes = {}) {
  const carregados = [];
  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    performance,
    setImmediate,
    setTimeout,
    clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    $: () => ({ ready() {}, on() { return this; }, length: 0 }),
    currentPage: 'dashboard',
    paginaPermitidaPorImplantacao: () => true,
    usuarioTemPermissao: () => true,
    showNotification() {},
    inicializarShellModulo() {}
  };
  context.document = {
    body: { classList: { remove() {} } },
    querySelector() { return null; },
    createElement() { return { dataset: {}, remove() {} }; },
    head: {
      appendChild(script) {
        setImmediate(() => {
          if (script.src === opcoes.falhaDownload) { script.onerror(); return; }
          carregados.push(script.src);
          if (EXECUTADOS.has(script.src) && script.src !== opcoes.semExecutar) {
            vm.runInContext(fonte(script.src), context, { filename: script.src });
          }
          script.onload();
        });
      }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fonte('/erp/js/app.js'), context, { filename: 'app.js' });
  return { context, carregados, loader: context.CdsErpLazyLoader };
}

const sessao = {
  fornecedor: 'Fornecedor de polpas (teste)',
  itens: [{ produto_nome: 'POLPA MARACUJA 400G', unidade: 'UN', ncm: '20089900', codigo_fornecedor: '1', codigo_barras: 'SEM GTIN' }]
};

const pendencia = {
  indice: 0,
  score: 62,
  produtoXML: sessao.itens[0],
  produtoEncontrado: { id: 904, nome: 'Polpa de Maracuja 400g', unidade: 'UN', ncm: '20089900', codigo: '904' },
  candidatoSelecionado: {
    produtoId: 904,
    motoresQueVotaram: ['motor_mubc'],
    atributosExtraidos: { motivosRelevancia: [{ tipo: 'descricao', rotulo: 'Descrição semelhante' }] }
  },
  candidatos: []
};

function renderizar(context) {
  const api = context.MiipCentralRevisao._test;
  api.definirEstado({
    opcoes: { produtos: [] },
    sessao,
    inteligencia: { linhas: [], cacheUltimasCompras: { 904: { status: 'ok', view: { disponivel: false } } } }
  });
  return api.renderComparacaoV2(pendencia, sessao);
}

describe('Manifesto lazy', () => {
  for (const pagina of ['compras', 'central-entradas']) {
    test(`${pagina}: módulo de comparação antes da tela de revisão`, () => {
      const { loader } = criarErp();
      const scripts = Array.from(loader.manifest[pagina]);
      const i = scripts.indexOf(URL_INTELIGENTE);
      assert.ok(i >= 0, 'módulo de comparação no manifesto');
      assert.ok(i < scripts.indexOf(URL_REVISAO));
    });
  }
});

describe('Comparação na interface', () => {
  for (const pagina of ['compras', 'central-entradas']) {
    test(`${pagina}: campos comparados aparecem e a pontuação não é exibida como probabilidade`, async () => {
      const { context, carregados, loader } = criarErp();
      await loader.loadPageScripts(pagina);
      assert.ok(carregados.indexOf(URL_INTELIGENTE) < carregados.indexOf(URL_REVISAO));
      assert.ok(context.MiipRevisaoInteligente?.montarComparacaoVisual);

      const html = renderizar(context);
      for (const campo of ['Descrição', 'NCM', 'Unidade', 'Fornecedor']) {
        assert.match(html, new RegExp(`miip-v2-linha-campo">${campo}<`), `linha ${campo}`);
      }
      assert.match(html, /Semelhante \(\d+%\)|Igual/);
      assert.doesNotMatch(html, /Sem campos para comparar/);
      assert.doesNotMatch(html, /Comparação indisponível/);
      assert.match(html, /Semelhança/);
      assert.match(html, /62\/100/);
      assert.match(html, /Não é a probabilidade/);
      assert.doesNotMatch(html, /62%/);
    });
  }

  test('módulo carregado sem registrar a API: aviso explícito, sem barra nem comparação vazia', async () => {
    const { context, loader } = criarErp({ semExecutar: URL_INTELIGENTE });
    await loader.loadPageScripts('central-entradas');
    assert.equal(context.MiipRevisaoInteligente, undefined);
    const html = renderizar(context);
    assert.match(html, /Comparação indisponível/);
    assert.match(html, /Recarregue a tela/);
    assert.doesNotMatch(html, /Sem campos para comparar/);
    assert.doesNotMatch(html, /miip-v2-confianca-barra/);
  });

  test('falha no download do módulo: a página não abre com a revisão incompleta', async () => {
    const { context, carregados, loader } = criarErp({ falhaDownload: URL_INTELIGENTE });
    await assert.rejects(loader.loadPageScripts('central-entradas'), /miip-central-revisao-inteligente/);
    assert.equal(carregados.includes(URL_REVISAO), false);
    assert.equal(context.MiipCentralRevisao, undefined);
  });
});
