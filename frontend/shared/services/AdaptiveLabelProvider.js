/**
 * CDS Design System V2 — Adaptive Label Provider (UX-001.1)
 * Bootstrap oficial do componente Adaptive Labels.
 * Telas devem consumir AdaptiveLabelService — nunca if(F12) para labels.
 */
(function (global) {
  'use strict';

  const COMPONENT_ID = 'cds.designSystem.adaptiveLabels';
  const VERSION = '2.0.0-ux001.1';

  function ready() {
    return !!(
      global.AdaptiveLabelRegistry &&
      global.AdaptiveLabelContext &&
      global.AdaptiveLabelService
    );
  }

  function init(opcoes) {
    const opts = opcoes || {};
    if (!ready()) {
      console.warn('[AdaptiveLabelProvider] Registry/Context/Service não carregados.');
      return false;
    }
    if (opts.idioma && typeof global.AdaptiveLabelContext.setIdioma === 'function') {
      global.AdaptiveLabelContext.setIdioma(opts.idioma);
    }
    if (opts.perfil && typeof global.AdaptiveLabelContext.setPerfil === 'function') {
      global.AdaptiveLabelContext.setPerfil(opts.perfil);
    }
    if (Array.isArray(opts.domains)) {
      opts.domains.forEach((d) => {
        if (d && d.id) global.AdaptiveLabelService.registerDomain(d.id, d);
      });
    }

    global.CDS = global.CDS || {};
    global.CDS.DesignSystem = global.CDS.DesignSystem || {};
    global.CDS.DesignSystem.AdaptiveLabels = {
      id: COMPONENT_ID,
      version: VERSION,
      service: global.AdaptiveLabelService,
      context: global.AdaptiveLabelContext,
      registry: global.AdaptiveLabelRegistry,
      provider: AdaptiveLabelProvider
    };

    return true;
  }

  function getService() {
    return global.AdaptiveLabelService || null;
  }

  function getContext() {
    return global.AdaptiveLabelContext || null;
  }

  function getRegistry() {
    return global.AdaptiveLabelRegistry || null;
  }

  /** Atalho oficial para telas: CDS.labels('vendas') */
  function labels(domain, opts) {
    return getService()?.getLabel?.(domain, opts) || String(domain || '');
  }

  const AdaptiveLabelProvider = {
    COMPONENT_ID,
    VERSION,
    ready,
    init,
    getService,
    getContext,
    getRegistry,
    labels
  };

  global.AdaptiveLabelProvider = AdaptiveLabelProvider;

  // Auto-init quando scripts já foram carregados
  if (ready()) {
    init();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdaptiveLabelProvider;
  }
})(typeof window !== 'undefined' ? window : global);
