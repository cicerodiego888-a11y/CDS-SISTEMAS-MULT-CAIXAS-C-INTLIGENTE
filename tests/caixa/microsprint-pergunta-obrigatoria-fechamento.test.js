'use strict';

/**
 * Microsprint — pergunta obrigatória de impressão no fechamento de caixa (ERP e PDV).
 * Política real reportada: fiscal e não fiscal em NAO_IMPRIMIR, destinos CLIENTE + ESTABELECIMENTO.
 * Executa caixa.js + caixaPermissoes.js + cupomPrintPolicy.js reais num contexto isolado,
 * com DOM, backend e impressora simulados: nenhum caixa real é movimentado.
 * node --test tests/caixa/microsprint-pergunta-obrigatoria-fechamento.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CUPOM_HTML = '<html><head></head><body><pre>FECHAMENTO DE CAIXA</pre></body></html>';
const DESTINOS = ['CLIENTE', 'ESTABELECIMENTO'];
const POLITICA_REAL = {
  modo: 'NAO_IMPRIMIR',
  fiscal: { modo: 'NAO_IMPRIMIR', vias: 2, destinos: DESTINOS },
  nao_fiscal: { modo: 'NAO_IMPRIMIR', vias: 2, destinos: DESTINOS }
};
const POLITICA_AUTOMATICA = {
  modo: 'AUTOMATICO',
  fiscal: { modo: 'AUTOMATICO', vias: 2, destinos: DESTINOS },
  nao_fiscal: { modo: 'AUTOMATICO', vias: 2, destinos: DESTINOS }
};

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
function criarBackend(politica) {
  const estado = { aberto: true, fechamentos: [], retiradas: [], saldoFinal: null, eventos: [] };
  const encadeavel = new Proxy(function () {}, {
    get: (_, prop) => (prop === 'length' ? 0 : () => encadeavel),
    apply: () => encadeavel
  });
  const $ = () => encadeavel;
  $.get = () => encadeavel;
  $.ajax = (opts) => {
    const url = String(opts.url || '');
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
      return { json: async () => ({ valor: politica }) };
    }
    if (String(url).endsWith('/configuracoes/cupom_impressao_evento')) {
      estado.eventos.push(JSON.parse(init.body));
    }
    return { json: async () => ({}) };
  };
  return { estado, $, fetch };
}

function montarTela(modulo, { politica = POLITICA_REAL, extras = {} } = {}) {
  const dom = criarDom();
  const backend = criarBackend(politica);
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
    },
    ...extras
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ler('frontend/shared/js/caixaPermissoes.js'), ctx);
  vm.runInContext(ler('frontend/shared/js/cupomPrintPolicy.js'), ctx);
  if (modulo) vm.runInContext(ler(`frontend/${modulo}/js/caixa.js`), ctx);
  return { ctx, dom, backend, impressoes, comprovantes, notificacoes };
}

async function aguardar(cond, rotulo) {
  for (let i = 0; i < 200; i += 1) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`tempo esgotado: ${rotulo}`);
}

async function esperarCiclos(n = 30) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
}

const PAYLOADS = {
  total: { valor_informado: 301.99, dinheiro_conferido: 301.99, modo_retirada: 'total', retirada_fechamento: 301.99, observacao: '', justificativa_divergencia: '', fechar_com_divergencia: false },
  parcial: { valor_informado: 301.99, dinheiro_conferido: 301.99, modo_retirada: 'valor', retirada_fechamento: 101.99, observacao: '', justificativa_divergencia: '', fechar_com_divergencia: false }
};

async function fecharCaixa(tela, tipo) {
  tela.ctx.enviarFechamentoCaixa({ ...PAYLOADS[tipo] });
  await aguardar(() => tela.dom.overlays.length > 0, 'pergunta de impressão');
}

function assertUmFechamento(tela, tipo) {
  const { estado } = tela.backend;
  assert.equal(estado.fechamentos.length, 1, 'um único fechamento');
  assert.equal(estado.retiradas.length, 1, 'uma única retirada');
  assert.equal(estado.aberto, false, 'caixa permanece fechado');
  assert.deepEqual(estado.fechamentos[0], { ...PAYLOADS[tipo], terminal_id: 1 }, 'payload intacto');
  assert.equal(estado.saldoFinal, tipo === 'parcial' ? 200 : 0);
}

describe('Evidência — política real resolve NAO_IMPRIMIR para fiscal e não fiscal', () => {
  it('resolver devolve NAO_IMPRIMIR com destinos CLIENTE e ESTABELECIMENTO', () => {
    const { ctx } = montarTela(null);
    ctx.CupomPrintPolicy.aplicarCache(POLITICA_REAL);
    for (const tipo of ['FISCAL', 'NAO_FISCAL']) {
      const d = ctx.CupomPrintPolicy.resolver(tipo, {});
      assert.equal(d.modo, 'NAO_IMPRIMIR');
      assert.equal(JSON.stringify(d.destinos), JSON.stringify(DESTINOS));
      assert.equal(d.perguntar, false);
    }
  });
});

for (const modulo of ['erp', 'pdv']) {
  describe(`Fechamento ${modulo.toUpperCase()} — pergunta obrigatória com política NAO_IMPRIMIR`, () => {
    for (const tipo of ['parcial', 'total']) {
      it(`retirada ${tipo}: pergunta aparece e nada é impresso antes da decisão`, async () => {
        const tela = montarTela(modulo);
        await fecharCaixa(tela, tipo);
        assert.equal(tela.dom.overlays.length, 1);
        assert.match(tela.dom.overlays[0].innerHTML, /Você deseja imprimir o cupom\?/);
        assert.equal(tela.comprovantes[0].html, CUPOM_HTML);
        assert.equal(tela.comprovantes[0].opts.enviarImpressora, false);
        await esperarCiclos();
        assert.equal(tela.impressoes.length, 0, 'sem impressão automática');
        assertUmFechamento(tela, tipo);
      });

      it(`retirada ${tipo}: "Sim" imprime exatamente uma via`, async () => {
        const tela = montarTela(modulo);
        await fecharCaixa(tela, tipo);
        tela.dom.overlays[0].botoes.sim.click();
        tela.dom.overlays.length && tela.dom.overlays[0].botoes.sim.click();
        await aguardar(() => tela.ctx.CupomPrintPolicy.estado() === 'IMPRESSO', 'impressão');
        await esperarCiclos();
        assert.equal(tela.impressoes.length, 1, 'uma única via');
        assert.equal(tela.impressoes[0].deviceName, 'IMPRESSORA-MOCK');
        assert.match(tela.impressoes[0].html, /FECHAMENTO DE CAIXA/);
        assert.match(tela.impressoes[0].html, /VIA DO ESTABELECIMENTO/);
        assert.doesNotMatch(tela.impressoes[0].html, /VIA DO CLIENTE/);
        assert.equal(tela.dom.overlays.length, 0);
        assertUmFechamento(tela, tipo);
      });

      it(`retirada ${tipo}: "Não" não imprime e preserva o fechamento`, async () => {
        const tela = montarTela(modulo);
        await fecharCaixa(tela, tipo);
        tela.dom.overlays[0].botoes.nao.click();
        await aguardar(() => tela.backend.estado.eventos.length > 0, 'evento registrado');
        await esperarCiclos();
        assert.equal(tela.impressoes.length, 0);
        assert.equal(tela.dom.overlays.length, 0);
        assert.equal(tela.backend.estado.eventos[0].decisao, 'NAO');
        assert.ok(tela.notificacoes.some((n) => n.m === 'Caixa fechado com sucesso.' && n.t === 'success'));
        assertUmFechamento(tela, tipo);
      });

      it(`retirada ${tipo}: fechar a pergunta (Esc) não imprime e preserva o fechamento`, async () => {
        const tela = montarTela(modulo);
        await fecharCaixa(tela, tipo);
        tela.ctx.electronAPI.fecharComprovante();
        tela.dom.tecla('Escape');
        await aguardar(() => tela.ctx.CupomPrintPolicy.estado() === 'NAO_IMPRIMIR', 'cancelamento');
        await esperarCiclos();
        assert.equal(tela.impressoes.length, 0);
        assert.equal(tela.dom.overlays.length, 0);
        assertUmFechamento(tela, tipo);
      });
    }

    it('política AUTOMATICO também pergunta no fechamento (sem impressão automática)', async () => {
      const tela = montarTela(modulo, { politica: POLITICA_AUTOMATICA });
      await fecharCaixa(tela, 'parcial');
      await esperarCiclos();
      assert.equal(tela.dom.overlays.length, 1);
      assert.equal(tela.impressoes.length, 0);
      assertUmFechamento(tela, 'parcial');
    });
  });
}

describe('Outros documentos — comportamento da política inalterado', () => {
  it('NAO_IMPRIMIR: cupom de venda (fiscal e não fiscal) não pergunta nem imprime', async () => {
    const { ctx, dom, impressoes } = montarTela(null);
    for (const tipo of ['FISCAL', 'NAO_FISCAL']) {
      const r = await ctx.CupomPrintPolicy.aposCupomNaTela({ tipo, html: CUPOM_HTML, automatico: true });
      assert.equal(r.estado, 'NAO_IMPRIMIR');
    }
    assert.equal(dom.overlays.length, 0);
    assert.equal(impressoes.length, 0);
  });

  it('AUTOMATICO: cupom de venda continua imprimindo direto, sem pergunta', async () => {
    const { ctx, dom, impressoes } = montarTela(null, { politica: POLITICA_AUTOMATICA });
    const r = await ctx.CupomPrintPolicy.aposCupomNaTela({ tipo: 'FISCAL', html: CUPOM_HTML, automatico: true });
    assert.equal(r.ok, true);
    assert.equal(dom.overlays.length, 0);
    assert.equal(impressoes.length, 2);
  });

  it('reimpressão explícita segue o caminho anterior (pergunta obrigatória não se aplica)', async () => {
    const opcoes = { tipo: 'NAO_FISCAL', html: CUPOM_HTML, reimpressao: true, vias: 1, destinos: ['ESTABELECIMENTO'] };
    for (const politica of [POLITICA_REAL, POLITICA_AUTOMATICA]) {
      const sem = montarTela(null, { politica });
      const com = montarTela(null, { politica });
      const rSem = await sem.ctx.CupomPrintPolicy.aposCupomNaTela({ ...opcoes });
      const rCom = await com.ctx.CupomPrintPolicy.aposCupomNaTela({ ...opcoes, perguntaObrigatoria: true });
      assert.equal(JSON.stringify(rCom), JSON.stringify(rSem));
      assert.equal(com.dom.overlays.length, 0);
      assert.equal(com.impressoes.length, sem.impressoes.length);
    }
  });
});
