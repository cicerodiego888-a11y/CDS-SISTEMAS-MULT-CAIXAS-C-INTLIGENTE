/**
 * Sincroniza cadastro de produto com o PDV (venda em aberto).
 * ERP publica no save; PDV escuta e inclui o SKU no catálogo local sem limpar o carrinho.
 * BroadcastChannel + storage (abas) + último SKU em localStorage (volta ao PDV / Electron).
 */
(function (global) {
  'use strict';

  const CANAL = 'cds-catalogo-produtos';
  const STORAGE_KEY = 'cds-catalogo-produtos-ultimo';

  function obterCanal() {
    if (typeof BroadcastChannel === 'undefined') return null;
    try {
      if (!global.__cdsCatalogoProdutoChannel) {
        global.__cdsCatalogoProdutoChannel = new BroadcastChannel(CANAL);
      }
      return global.__cdsCatalogoProdutoChannel;
    } catch (_) {
      return null;
    }
  }

  function gravarUltimoProduto(payload) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      }
    } catch (_) { /* ignore */ }
  }

  function publicarProdutoSalvo(produto) {
    if (!produto || produto.id == null) return false;
    const ch = obterCanal();
    const payload = {
      tipo: 'produto-salvo',
      produto: produto,
      ts: Date.now()
    };
    gravarUltimoProduto(payload);
    if (ch) {
      try {
        ch.postMessage(payload);
      } catch (_) { /* ignore */ }
    }
    try {
      global.dispatchEvent(new CustomEvent(CANAL, { detail: payload }));
    } catch (_) { /* ignore */ }
    return true;
  }

  function consumirUltimoProdutoSalvo() {
    try {
      if (!global.localStorage) return null;
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function ouvir(handler) {
    if (typeof handler !== 'function') return function () {};
    const ch = obterCanal();
    const onBroadcast = function (ev) {
      handler(ev && ev.data ? ev.data : ev);
    };
    const onLocal = function (ev) {
      handler(ev && ev.detail ? ev.detail : ev);
    };
    const onStorage = function (ev) {
      if (!ev || ev.key !== STORAGE_KEY || !ev.newValue) return;
      try {
        handler(JSON.parse(ev.newValue));
      } catch (_) { /* ignore */ }
    };
    if (ch && typeof ch.addEventListener === 'function') {
      ch.addEventListener('message', onBroadcast);
    }
    if (global.addEventListener) {
      global.addEventListener(CANAL, onLocal);
      global.addEventListener('storage', onStorage);
    }
    return function cancelar() {
      if (ch && typeof ch.removeEventListener === 'function') {
        ch.removeEventListener('message', onBroadcast);
      }
      if (global.removeEventListener) {
        global.removeEventListener(CANAL, onLocal);
        global.removeEventListener('storage', onStorage);
      }
    };
  }

  global.CdsCatalogoProdutoSync = {
    CANAL: CANAL,
    STORAGE_KEY: STORAGE_KEY,
    publicarProdutoSalvo: publicarProdutoSalvo,
    consumirUltimoProdutoSalvo: consumirUltimoProdutoSalvo,
    ouvir: ouvir
  };
})(typeof window !== 'undefined' ? window : global);
