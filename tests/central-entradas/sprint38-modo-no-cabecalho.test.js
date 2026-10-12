/**
 * Sprint 3.8 — Modo ASSISTIDO/AUTOMÁTICO no cabeçalho azul; sem card branco separado.
 * Somente interface.
 *
 * Executar: node --test tests/central-entradas/sprint38-modo-no-cabecalho.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const mainSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');

function extrairFuncao(nome) {
  const inicio = mainSrc.search(new RegExp(`(async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  const fim = mainSrc.slice(inicio).search(/\r?\n\}\r?\n/);
  return mainSrc.slice(inicio, inicio + fim) + '\n}\n';
}

function criarContexto(extra = {}) {
  const ctx = {
    navigator: { onLine: true },
    window: {},
    centralEntradasState: { operacaoCentral: null, notificacoesNaoLidas: 0, ...(extra.state || {}) },
    escapeHtmlCentralEntradas: (v) => String(v == null ? '' : v),
    renderSefazOperacionalChipCentral: () => '<span class="chip-sefaz">SEFAZ: Normal</span>',
    centralUx: () => ({
      resolverEstadoServicoCentral: () => ({ codigo: 'monitorando', label: 'Monitorando' }),
      resolverCooldownSefaz656Ux: () => ({ ativo: false })
    }),
    ...(extra.globais || {})
  };
  vm.createContext(ctx);
  const fontes = ['renderChipModoOperacaoCentral', 'renderCabecalhoUx1Central', 'renderPainelOperacaoCentral']
    .map(extrairFuncao)
    .join('\n');
  vm.runInContext(`${fontes}
this.__chip = renderChipModoOperacaoCentral;
this.__header = renderCabecalhoUx1Central;
this.__painel = renderPainelOperacaoCentral;`, ctx);
  return ctx;
}

function blocoMeta(html) {
  const inicio = html.indexOf('class="central-rc40-header-meta"');
  const acoes = html.indexOf('class="central-rc40-header-acoes"');
  assert.ok(inicio > 0 && acoes > inicio, 'estrutura do cabeçalho inesperada');
  return html.slice(inicio, acoes);
}

describe('Sprint 3.8 — modo no cabeçalho azul', () => {
  it('render completo: chip do modo dentro dos indicadores do cabeçalho', () => {
    const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], contains: () => false };
    const ctx = criarContexto({
      state: { operacaoCentral: { modo: 'ASSISTIDO', modoLabel: 'Assistido' } },
      globais: { document: { getElementById: (id) => (id === 'centralUx1Header' ? container : null), activeElement: null } }
    });
    ctx.__header();
    const meta = blocoMeta(container.innerHTML);
    assert.match(meta, /central-ux1-modo-operacao/);
    assert.match(meta, /data-modo="ASSISTIDO"/);
    assert.match(meta, /Modo: ASSISTIDO/);
    assert.match(meta, /🟡/);
    assert.match(container.innerHTML, /id="centralBtnSincronizar"/);
    assert.match(container.innerHTML, /central-rc40-mais/);
  });

  it('atualização parcial (foco no cabeçalho) troca ASSISTIDO → AUTOMÁTICO', () => {
    const modoEl = {
      outerHTML: '<span class="central-ux1-modo-operacao" data-modo="ASSISTIDO">Modo: ASSISTIDO</span>'
    };
    const container = {
      querySelector: (sel) => {
        if (sel === '.central-rc40-header') return {};
        if (sel === '.central-ux1-modo-operacao') return modoEl;
        return null;
      },
      querySelectorAll: () => [],
      contains: () => true
    };
    const ctx = criarContexto({
      state: { operacaoCentral: { modo: 'AUTOMATICO' } },
      globais: {
        document: { getElementById: () => container, activeElement: null },
        UIFocusManager: { isInside: () => true }
      }
    });
    ctx.__header();
    assert.match(modoEl.outerHTML, /data-modo="AUTOMATICO"/);
    assert.match(modoEl.outerHTML, /Modo: AUTOMÁTICO/);
    assert.match(modoEl.outerHTML, /🟢/);
  });
});

describe('Sprint 3.8 — card branco eliminado', () => {
  function painel(operacao, wrapExistente = true) {
    let removido = false;
    let criado = false;
    const wrap = { innerHTML: 'card antigo', querySelectorAll: () => [], remove() { removido = true; } };
    const ctx = criarContexto({
      globais: {
        document: {
          getElementById: (id) => (id === 'centralOperacaoWrap' && wrapExistente ? wrap : null),
          createElement: () => { criado = true; return wrap; },
          querySelector: () => null
        }
      }
    });
    ctx.__painel(operacao, {});
    return { wrap, removido, criado };
  }

  it('ASSISTIDO sem pendências: card removido, sem título/modo duplicado', () => {
    const r = painel({ modo: 'ASSISTIDO', pendentes: [] });
    assert.equal(r.removido, true);
  });

  it('AUTOMÁTICO: card removido', () => {
    const r = painel({ modo: 'AUTOMATICO', pendentes: [{ action_id: 'x' }] });
    assert.equal(r.removido, true);
  });

  it('sem card prévio e sem pendências: nada é criado', () => {
    const r = painel({ modo: 'ASSISTIDO', pendentes: [] }, false);
    assert.equal(r.criado, false);
  });

  it('ASSISTIDO com pendências: só a lista de ações, sem "CENTRAL DE ENTRADAS" nem modo', () => {
    const r = painel({ modo: 'ASSISTIDO', pendentes: [{ action_id: 'a1', titulo: 'Baixar XML' }] });
    assert.equal(r.removido, false);
    assert.match(r.wrap.innerHTML, /AÇÕES PENDENTES/);
    assert.match(r.wrap.innerHTML, /data-action-id="a1"/);
    assert.doesNotMatch(r.wrap.innerHTML, /CENTRAL DE ENTRADAS/);
    assert.doesNotMatch(r.wrap.innerHTML, /ASSISTIDO|AUTOMÁTICO/);
  });
});
