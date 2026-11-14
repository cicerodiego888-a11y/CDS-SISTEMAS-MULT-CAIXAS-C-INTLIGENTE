'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pdvSource = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/pdv/js/pdv.js'),
  'utf8'
);

function extrairFuncao(nome, marcadorFim) {
  const inicio = pdvSource.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} encontrada`);
  const fim = pdvSource.indexOf(marcadorFim, inicio);
  assert.notEqual(fim, -1, `fim da função ${nome} encontrado`);
  return pdvSource.slice(inicio, fim + (marcadorFim.startsWith('\n}') ? 2 : 0));
}

function criarContexto() {
  const callbacksTimer = [];
  const eventosWindow = {};
  const eventosDocument = {};
  const chamadas = { focus: 0, select: 0 };
  const inputBusca = {
    id: 'buscaProdutoPdv',
    select: () => { chamadas.select += 1; }
  };
  const jqueryBusca = {
    length: 1,
    trigger: (evento) => {
      if (evento === 'focus') chamadas.focus += 1;
    },
    get: () => inputBusca
  };
  const body = { id: 'body' };
  const documento = {
    activeElement: body,
    visibilityState: 'visible',
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: (evento, callback) => {
      eventosDocument[evento] = callback;
    }
  };
  const janela = {
    UIFocusManager: { isEditingElement: () => false },
    addEventListener: (evento, callback) => {
      eventosWindow[evento] = callback;
    }
  };
  const sandbox = {
    window: janela,
    document: documento,
    currentPage: 'pdv',
    setTimeout: (callback) => callbacksTimer.push(callback),
    setInterval: () => 1,
    $: (seletor) => {
      if (seletor === '#buscaProdutoPdv') return jqueryBusca;
      return { empty: () => {} };
    },
    hidratarUltimoProdutoCatalogoPdv: () => {},
    agendarRecarregarCatalogoPdv: () => {},
    verificarVersaoCatalogoPdv: () => {}
  };

  vm.runInNewContext(
    `${extrairFuncao('focarCampoCodigo', '\n\n\nfunction obterNomeOperador')}\n` +
      `${extrairFuncao('inicializarSincronizacaoCatalogoPdv', '\n}\n\nwindow.upsertProdutoNoCatalogoPdv')}\n` +
      'inicializarSincronizacaoCatalogoPdv();',
    sandbox
  );

  return {
    callbacksTimer,
    eventosWindow,
    eventosDocument,
    chamadas,
    documento,
    sandbox
  };
}

function executarTimers(contexto) {
  contexto.callbacksTimer.splice(0).forEach((callback) => callback());
}

describe('PDV — restauração do foco da busca de produtos', () => {
  it('retorna o foco à busca quando a janela ou aba do PDV volta a ficar ativa', () => {
    const contexto = criarContexto();

    contexto.eventosWindow.focus();
    executarTimers(contexto);
    contexto.documento.activeElement = { id: 'body' };
    contexto.eventosDocument.visibilitychange();
    executarTimers(contexto);

    assert.equal(contexto.chamadas.focus, 2);
    assert.equal(contexto.chamadas.select, 2);
  });

  it('não rouba o foco de outro campo que o operador está editando', () => {
    const contexto = criarContexto();
    const campoEmEdicao = { id: 'quantidade-item' };
    contexto.documento.activeElement = campoEmEdicao;
    contexto.sandbox.window.UIFocusManager.isEditingElement = (elemento) => elemento === campoEmEdicao;

    contexto.eventosWindow.focus();
    executarTimers(contexto);

    assert.equal(contexto.chamadas.focus, 0);
    assert.equal(contexto.chamadas.select, 0);
  });

  it('executa o foco inicial depois de montar os widgets da tela', () => {
    const inicio = pdvSource.indexOf('function inicializarPDV()');
    const fim = pdvSource.indexOf('\n}\n\n// Verificar status do caixa', inicio);
    const inicializacao = pdvSource.slice(inicio, fim);

    assert.ok(inicializacao.indexOf('PdvFooterWidgets.init()') < inicializacao.indexOf('focarCampoCodigo()'));
    assert.ok(inicializacao.indexOf('PdvPrestacaoEntrega.init()') < inicializacao.indexOf('focarCampoCodigo()'));
    assert.ok(inicializacao.indexOf('PdvVendaEntrega.initUi()') < inicializacao.indexOf('focarCampoCodigo()'));
  });
});
