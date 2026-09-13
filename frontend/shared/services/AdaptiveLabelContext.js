/**
 * CDS Design System V2 — Adaptive Label Context (UX-001.1)
 * Modo operacional (F12), perfil e idioma futuro — ponto único.
 */
(function (global) {
  'use strict';

  let idiomaOverride = null;
  let perfilOverride = null;

  function isModoFiscalAtivo() {
    if (typeof global.modoFiscalAtivoSistema === 'function') {
      return global.modoFiscalAtivoSistema() === true;
    }
    if (typeof global.isModoFiscalVisualizacaoAtivo === 'function') {
      return global.isModoFiscalVisualizacaoAtivo() === true;
    }
    return global.localStorage && global.localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
  }

  /** @returns {'fiscal'|'completo'} */
  function getModoOperacional() {
    return isModoFiscalAtivo() ? 'fiscal' : 'completo';
  }

  function deveExibirNaoFiscal() {
    return !isModoFiscalAtivo();
  }

  function deveExibirSufixoFiscal() {
    return !isModoFiscalAtivo();
  }

  function getPerfil() {
    if (perfilOverride) return perfilOverride;
    try {
      const user = JSON.parse(global.localStorage?.getItem('user') || '{}');
      return String(user.perfil || user.role || 'USUARIO').toUpperCase();
    } catch {
      return 'USUARIO';
    }
  }

  /**
   * Idioma futuro (i18n). Default pt-BR.
   * @returns {'pt-BR'|'en-US'|'es-ES'|string}
   */
  function getIdioma() {
    if (idiomaOverride) return idiomaOverride;
    try {
      const stored = global.localStorage?.getItem('cds_locale');
      if (stored) return stored;
    } catch { /* noop */ }
    return 'pt-BR';
  }

  function setIdioma(locale) {
    idiomaOverride = locale || null;
    return getIdioma();
  }

  function setPerfil(perfil) {
    perfilOverride = perfil || null;
    return getPerfil();
  }

  function snapshot() {
    return {
      modo: getModoOperacional(),
      modoFiscalAtivo: isModoFiscalAtivo(),
      perfil: getPerfil(),
      idioma: getIdioma(),
      exibirNaoFiscal: deveExibirNaoFiscal()
    };
  }

  const AdaptiveLabelContext = {
    isModoFiscalAtivo,
    getModoOperacional,
    deveExibirNaoFiscal,
    deveExibirSufixoFiscal,
    getPerfil,
    getIdioma,
    setIdioma,
    setPerfil,
    snapshot
  };

  global.AdaptiveLabelContext = AdaptiveLabelContext;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdaptiveLabelContext;
  }
})(typeof window !== 'undefined' ? window : global);
