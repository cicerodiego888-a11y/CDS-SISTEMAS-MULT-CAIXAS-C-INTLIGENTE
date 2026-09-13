/**
 * CDS Design System V2 — Adaptive Label Service (UX-001.1)
 * API oficial obrigatória de nomenclatura.
 *
 * AdaptiveLabelService.getLabel(domain, { scope, locale })
 * AdaptiveLabelService.getPlural(domain, { scope, locale })
 * AdaptiveLabelService.getShortLabel(domain, { scope, locale })
 * AdaptiveLabelService.getDescription(domain, { scope, locale })
 */
(function (global) {
  'use strict';

  function registry() {
    return global.AdaptiveLabelRegistry;
  }

  function context() {
    return global.AdaptiveLabelContext;
  }

  function normalizarEscopo(scope) {
    const s = String(scope || 'fiscal').toLowerCase();
    if (s === 'nao_fiscal' || s === 'nao-fiscal' || s === 'naofiscal' || s === 'non_fiscal') {
      return 'nao_fiscal';
    }
    return 'fiscal';
  }

  function resolveI18n(def, variant, opts) {
    const ctx = context();
    if (!def || typeof global.AdaptiveI18n?.resolve !== 'function') return null;
    const locale = opts.locale || ctx?.getIdioma?.() || 'pt-BR';
    return global.AdaptiveI18n.resolve(def.i18nKey, locale, {
      mode: ctx?.getModoOperacional?.(),
      scope: normalizarEscopo(opts.scope),
      variant,
      perfil: ctx?.getPerfil?.()
    });
  }

  function pickVariant(def, fieldBase, fieldFiscal, fieldNaoFiscal, opts) {
    const ctx = context();
    if (!def) return '';
    if (ctx?.isModoFiscalAtivo?.()) {
      return def[fieldBase] || def.base || '';
    }
    const scope = normalizarEscopo(opts.scope);
    if (scope === 'nao_fiscal') {
      return def[fieldNaoFiscal] || def.naoFiscal || def.base || '';
    }
    return def[fieldFiscal] || def.fiscal || def.base || '';
  }

  function getLabel(domain, opcoes) {
    const opts = opcoes || {};
    const reg = registry();
    const def = reg?.get?.(domain);
    if (!def) return String(domain || '');

    const translated = resolveI18n(def, 'label', opts);
    if (translated) return translated;
    return pickVariant(def, 'base', 'fiscal', 'naoFiscal', opts);
  }

  function getPlural(domain, opcoes) {
    const opts = opcoes || {};
    const def = registry()?.get?.(domain);
    if (!def) return getLabel(domain, opts);

    const translated = resolveI18n(def, 'plural', opts);
    if (translated) return translated;
    return pickVariant(def, 'pluralBase', 'pluralFiscal', 'pluralNaoFiscal', opts);
  }

  function getShortLabel(domain, opcoes) {
    const opts = opcoes || {};
    const def = registry()?.get?.(domain);
    if (!def) return getLabel(domain, opts);

    const translated = resolveI18n(def, 'short', opts);
    if (translated) return translated;
    return pickVariant(def, 'shortBase', 'shortFiscal', 'shortNaoFiscal', opts);
  }

  function getDescription(domain, opcoes) {
    const opts = opcoes || {};
    const def = registry()?.get?.(domain);
    if (!def) return '';

    const translated = resolveI18n(def, 'description', opts);
    if (translated) return translated;
    return pickVariant(def, 'descriptionBase', 'descriptionFiscal', 'descriptionNaoFiscal', opts);
  }

  function getBadge(scope) {
    const ctx = context();
    if (!ctx || ctx.isModoFiscalAtivo()) return '';
    return normalizarEscopo(scope) === 'nao_fiscal'
      ? getLabel('badge_nao_fiscal', { scope: 'nao_fiscal' })
      : getLabel('badge_fiscal', { scope: 'fiscal' });
  }

  function labelForWidget(widget) {
    const w = widget || {};
    const mapped = registry()?.getWidgetKey?.(w.id);
    if (mapped) {
      return getLabel(mapped.domain, { scope: mapped.scope || w.scope });
    }
    const domainHint = w.labelDomain || w.domain;
    if (domainHint && registry()?.get?.(domainHint)) {
      return getLabel(domainHint, { scope: w.scope });
    }
    return sanitize(w.title || '');
  }

  function sanitize(texto) {
    const raw = String(texto == null ? '' : texto);
    const ctx = context();
    if (!ctx || !ctx.isModoFiscalAtivo()) return raw;

    let out = raw;
    out = out.replace(/n.o[\s\-]*fisca(?:l|is)/gi, '');
    out = out.replace(/fisca(?:l|is)/gi, '');
    out = out.replace(/\s{2,}/g, ' ');
    out = out.replace(/\s+([,.;:!?])/g, '$1');
    out = out.replace(/^\s+|\s+$/g, '');
    out = out.replace(/^[,.;:\-–—]\s*/g, '');
    return out;
  }

  function shouldShowNaoFiscal() {
    const ctx = context();
    return ctx ? ctx.deveExibirNaoFiscal() : true;
  }

  function getModo() {
    const ctx = context();
    return ctx ? ctx.getModoOperacional() : 'completo';
  }

  function registerDomain(domain, definition) {
    return registry()?.register?.(domain, definition) === true;
  }

  const AdaptiveLabelService = {
    getLabel,
    getPlural,
    getShortLabel,
    getDescription,
    getBadge,
    labelForWidget,
    sanitize,
    shouldShowNaoFiscal,
    getModo,
    registerDomain,
    label: getLabel
  };

  global.AdaptiveLabelService = AdaptiveLabelService;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdaptiveLabelService;
  }
})(typeof window !== 'undefined' ? window : global);
