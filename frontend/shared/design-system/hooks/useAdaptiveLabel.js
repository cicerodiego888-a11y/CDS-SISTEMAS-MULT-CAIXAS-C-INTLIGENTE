(function (global) {
  'use strict';

  function useAdaptiveLabel() {
    const svc = global.AdaptiveLabelService || global.CDS?.DesignSystem?.AdaptiveLabels?.service;
    return {
      getLabel: (d, o) => svc?.getLabel?.(d, o) || String(d || ''),
      getPlural: (d, o) => svc?.getPlural?.(d, o) || svc?.getLabel?.(d, o) || String(d || ''),
      getShortLabel: (d, o) => svc?.getShortLabel?.(d, o) || svc?.getLabel?.(d, o) || String(d || ''),
      getDescription: (d, o) => svc?.getDescription?.(d, o) || '',
      sanitize: (t) => svc?.sanitize?.(t) || String(t ?? ''),
      shouldShowNaoFiscal: () => svc?.shouldShowNaoFiscal?.() !== false,
      service: svc || null
    };
  }
  global.useAdaptiveLabel = useAdaptiveLabel;

  if (typeof module !== 'undefined' && module.exports) module.exports = useAdaptiveLabel;
})(typeof window !== 'undefined' ? window : global);
