'use strict';

/**
 * Microsprint — opção de impressão no fechamento de caixa com retirada parcial.
 * Executa o caixa.js real (ERP e PDV) + caixaPermissoes.js + cupomPrintPolicy.js num contexto
 * isolado, com DOM, backend e impressora simulados: nenhum caixa real é movimentado.
 * node --test tests/caixa/microsprint-impressao-fechamento-parcial.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CUPOM_HTML = '<html><head></head><body><pre>FECHAMENTO DE CAIXA</pre></body></html>';

function criarDom() {
  const overlays = [];
  const listeners = {};
  const botao = () => {
    const fns = [];
    return {
      disabled: false,
      textContent: '',
      addEventListener: (tipo, fn) => { if (tipo === 'click') fns.push(fn); },
      click: () => fns.forEach((fn) => fn()),
      focus() {}
    };
  };
  const document = {
    createElement() {
      return {
        className: '',
        innerHTML: '',
        botoes: { nao: botao(), sim: botao() },
        querySelector(sel) {
          const m = /data-act="(\w+)"/.exec(sel);
          return m ? this.botoes[m[1]] : null;
        },
        remove() {
          const i = overlays.indexOf(this);
          if (i >= 0) overlays.splice(i, 1);
        }
      };
    },
    querySelectorAll: (sel) => (sel === '.cds-ui-cupom-print-overlay' ? overlays.slice() : []),
    querySelector: (sel) => (/data-act="sim"/.test(sel) && overlays[0] ? overlays[0].botoes.sim : null),
    getElementById: () => null,
    addEventListener: (tipo, fn) => { (listeners[tipo] = listeners[tipo] || []).push(fn); },
    removeEventListener: (tipo, fn) => { listeners[tipo] = (listeners[tipo] || []).filter((f) => f !== fn); },
    body: { appendChild: (el) => overlays.push(el) }
  };
  return {
    document,
    overlays,
    tecla: (key) => (listeners.keydown || []).slice().forEach((fn) => fn({ key, preventDefault() {} }))
  };
}

/** Backend de caixa em memória: um caixa aberto com R$ 301,99 esperados. */
function criarBackend() {
  const estado = { aberto: true, fechamentos: [], retiradas: [], saldoFinal: null, consultasAberto: 0, eventos: [] };
  const encadeavel = new Proxy(function () {}, {
    get: (_, prop) => (prop === 'length' ? 0 : () => encadeavel),
    apply: () => encadeavel
  });
  const $ = () => encadeavel;
  $.get = () => encadeavel;
  $.ajax = (opts) => {
    const url = String(opts.url || '');
    if (url.endsWith('/caixa/aberto')) {
      estado.consultasAberto += 1;
      return encadeavel;
    }
    if (url.endsWith('/caixa/fechar') && opts.method === 'POST') {
      const body = JSON.parse(opts.data);
      if (!estado.aberto) {
        return Promise.reject({ responseJSON: { error: 'Esta sessão já foi fechada.', codigo: 'SESSAO_JA_FECHADA' } });
      }
      const conferido = Number(body.dinheiro_conferido);
      const retirada = body.modo_retirada === 'total' ? conferido : Number(body.retirada_fechamento || 0);
      estado.aberto = false;
      estado.fechamentos.push(body);
      if (retirada > 0) estado.retiradas.push(retirada);
      estado.saldoFinal = Number((conferido - retirada).toFixed(2));
      return Promise.resolve({ message: 'Caixa fechado com sucesso.', caixa_id: 77, sessao_id: 501, cupom_html: CUPOM_HTML });
    }
    return encadeavel;
  };
  const fetch = async (url, init) => {
    if (String(url).endsWith('/configuracoes/cupom_impressao_politica')) {
      return { json: async () => ({ valor: { modo: 'PERGUNTAR' } }) };
    }
    if (String(url).endsWith('/configuracoes/cupom_impressao_evento')) {
      estado.eventos.push(JSON.parse(init.body));
    }
    return { json: async () => ({}) };
  };
  return { estado, $, fetch };
}

function montarTela(modulo, { comPolitica = true } = {}) {
  const dom = criarDom();
  const backend = criarBackend();
  const impressoes = [];
  const comprovantes = [];
  const notificacoes = [];
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    document: dom.document,
    $: backend.$,
    fetch: backend.fetch,
    API_URL: '/api',
    terminalId: 1,
    localStorage: { getItem: () => 'token-mock' },
    obterUsuarioLogado: () => ({ id: 1, role: 'admin', perfil: 'ADMIN', permissoes: [] }),
    showNotification: (m, t) => notificacoes.push({ m, t }),
    confirm: () => true,
    obterDeviceNameImpressoraCupom: async () => 'IMPRESSORA-MOCK',
    electronAPI: {
      abrirComprovante: (html, opts) => comprovantes.push({ html, opts }),
      fecharComprovante: () => comprovantes.push({ fechado: true }),
      imprimirDANFESilencioso: async (html, deviceName) => {
        impressoes.push({ html, deviceName });
        return { sucesso: true };
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ler('frontend/shared/js/caixaPermissoes.js'), ctx);
  if (comPolitica) vm.runInContext(ler('frontend/shared/js/cupomPrintPolicy.js'), ctx);
  vm.runInContext(ler(`frontend/${modulo}/js/caixa.js`), ctx);
  return { ctx, dom, backend, impressoes, comprovantes, notificacoes };
}

async function aguardar(cond, rotulo) {
  for (let i = 0; i < 200; i += 1) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`tempo esgotado: ${rotulo}`);
}

const PAYLOADS = {
  total: { valor_informado: 301.99, dinheiro_conferido: 301.99, modo_retirada: 'total', retirada_fechamento: 301.99, observacao: '', justificativa_divergencia: '', fechar_com_divergencia: false },
  parcial: { valor_informado: 301.99, dinheiro_conferido: 301.99, modo_retirada: 'valor', retirada_fechamento: 101.99, observacao: '', justificativa_divergencia: '', fechar_com_divergencia: false }
};

async function fecharCaixa(tela, tipo) {
  tela.ctx.enviarFechamentoCaixa({ ...PAYLOADS[tipo] });
  await aguardar(() => tela.dom.overlays.length > 0 || tela.notificacoes.length > 1, 'fim do fechamento');
}

function assertUmFechamento(tela, tipo) {
  const { estado } = tela.backend;
  assert.equal(estado.fechamentos.length, 1, 'um único fechamento');
  assert.equal(estado.retiradas.length, 1, 'uma única retirada');
  assert.equal(estado.aberto, false, 'caixa permanece fechado');
  assert.deepEqual(estado.fechamentos[0], { ...PAYLOADS[tipo], terminal_id: 1 }, 'payload intacto');
  if (tipo === 'parcial') {
    assert.equal(estado.retiradas[0], 101.99);
    assert.equal(estado.saldoFinal, 200);
  } else {
    assert.equal(estado.retiradas[0], 301.99);
    assert.equal(estado.saldoFinal, 0);
  }
}

for (const modulo of ['erp', 'pdv']) {
  describe(`Fechamento de caixa ${modulo.toUpperCase()} — opção de impressão`, () => {
    it('1. retirada total: a opção de impressão é apresentada', async () => {
      const tela = montarTela(modulo);
      await fecharCaixa(tela, 'total');
      assert.equal(tela.dom.overlays.length, 1);
      assert.equal(tela.comprovantes[0].html, CUPOM_HTML);
      assert.equal(tela.impressoes.length, 0, 'nada impresso antes da decisão');
      assertUmFechamento(tela, 'total');
    });

    it('2. retirada parcial: a mesma opção é apresentada', async () => {
      const tela = montarTela(modulo);
      await fecharCaixa(tela, 'parcial');
      assert.equal(tela.dom.overlays.length, 1);
      assert.equal(tela.comprovantes[0].html, CUPOM_HTML);
      assert.equal(tela.comprovantes[0].opts.aguardarDecisao, true);
      assert.equal(tela.impressoes.length, 0, 'nada impresso antes da decisão');
      assertUmFechamento(tela, 'parcial');
    });

    it('3. escolher imprimir: o comprovante sai pelo fluxo existente', async () => {
      const tela = montarTela(modulo);
      await fecharCaixa(tela, 'parcial');
      tela.dom.overlays[0].botoes.sim.click();
      await aguardar(() => tela.impressoes.length > 0 && tela.ctx.CupomPrintPolicy.estado() === 'IMPRESSO', 'impressão');
      assert.equal(tela.impressoes.length, 1);
      assert.equal(tela.impressoes[0].deviceName, 'IMPRESSORA-MOCK');
      assert.match(tela.impressoes[0].html, /FECHAMENTO DE CAIXA/);
      assert.match(tela.impressoes[0].html, /VIA DO ESTABELECIMENTO/);
      assert.equal(tela.dom.overlays.length, 0);
      assertUmFechamento(tela, 'parcial');
    });

    it('4. escolher não imprimir: o fechamento permanece concluído', async () => {
      const tela = montarTela(modulo);
      await fecharCaixa(tela, 'parcial');
      tela.dom.overlays[0].botoes.nao.click();
      await aguardar(() => tela.ctx.CupomPrintPolicy.estado() === 'NAO_IMPRIMIR', 'decisão não');
      await aguardar(() => tela.backend.estado.eventos.length > 0, 'evento registrado');
      assert.equal(tela.impressoes.length, 0);
      assert.equal(tela.dom.overlays.length, 0);
      assert.equal(tela.backend.estado.eventos[0].decisao, 'NAO');
      assertUmFechamento(tela, 'parcial');
    });

    it('5. cancelar a pergunta ou fechar a janela do comprovante não desfaz o fechamento', async () => {
      const tela = montarTela(modulo);
      await fecharCaixa(tela, 'parcial');
      // A tela já recarregou o estado do caixa (fechado) antes de qualquer decisão.
      assert.ok(tela.backend.estado.consultasAberto >= 1);
      assert.ok(tela.notificacoes.some((n) => n.m === 'Caixa fechado com sucesso.' && n.t === 'success'));
      tela.ctx.electronAPI.fecharComprovante();
      tela.dom.tecla('Escape');
      await aguardar(() => tela.ctx.CupomPrintPolicy.estado() === 'NAO_IMPRIMIR', 'cancelamento');
      assert.equal(tela.impressoes.length, 0);
      assert.equal(tela.dom.overlays.length, 0);
      assertUmFechamento(tela, 'parcial');
    });

    it('6. sem segundo fechamento nem segunda retirada (nova tentativa é recusada pelo backend)', async () => {
      const tela = montarTela(modulo);
      await fecharCaixa(tela, 'parcial');
      tela.dom.overlays[0].botoes.sim.click();
      await aguardar(() => tela.impressoes.length > 0, 'impressão');
      tela.ctx.enviarFechamentoCaixa({ ...PAYLOADS.parcial });
      await aguardar(() => tela.notificacoes.some((n) => /já foi fechada/.test(n.m)), 'recusa do segundo fechamento');
      assert.equal(tela.impressoes.length, 1);
      assertUmFechamento(tela, 'parcial');
    });
  });
}

describe('Causa raiz — a tela de caixa precisa carregar a política de impressão', () => {
  it('sem CupomPrintPolicy carregada, o fechamento não pergunta (comportamento anterior do ERP)', async () => {
    const tela = montarTela('erp', { comPolitica: false });
    delete tela.ctx.obterDeviceNameImpressoraCupom;
    tela.ctx.enviarFechamentoCaixa({ ...PAYLOADS.parcial });
    await aguardar(() => tela.notificacoes.length > 1, 'fim do fechamento');
    assert.equal(tela.dom.overlays.length, 0);
    assert.ok(tela.notificacoes.some((n) => /Configure a impressora de cupom/.test(n.m)));
    assertUmFechamento(tela, 'parcial');
  });

  it('ERP: a página caixa carrega cupomPrintPolicy.js e fiscalImpressao.js antes de caixa.js', () => {
    const app = ler('frontend/erp/js/app.js');
    const m = /\bcaixa:\s*(\[[^\]]*\])/.exec(app);
    assert.ok(m, 'entrada caixa no mapa de scripts do ERP');
    const scripts = JSON.parse(m[1].replace(/'/g, '"'));
    const iCaixa = scripts.indexOf('/erp/js/caixa.js');
    assert.ok(iCaixa >= 0);
    assert.ok(scripts.indexOf('/shared/js/cupomPrintPolicy.js') >= 0 && scripts.indexOf('/shared/js/cupomPrintPolicy.js') < iCaixa);
    assert.ok(scripts.indexOf('/shared/js/fiscalImpressao.js') >= 0 && scripts.indexOf('/shared/js/fiscalImpressao.js') < iCaixa);
  });

  it('PDV: index.html carrega cupomPrintPolicy.js e fiscalImpressao.js antes de caixa.js', () => {
    const html = ler('frontend/pdv/index.html');
    const iCaixa = html.indexOf('/pdv/js/caixa.js');
    assert.ok(iCaixa > 0);
    assert.ok(html.indexOf('/shared/js/cupomPrintPolicy.js') > 0 && html.indexOf('/shared/js/cupomPrintPolicy.js') < iCaixa);
    assert.ok(html.indexOf('/shared/js/fiscalImpressao.js') > 0 && html.indexOf('/shared/js/fiscalImpressao.js') < iCaixa);
  });
});
