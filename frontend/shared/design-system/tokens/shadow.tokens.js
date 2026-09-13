(function (global) {
  'use strict';

  const CDSShadowTokens = Object.freeze({
    none: 'none',
    sm: '0 1px 2px rgba(16, 24, 40, 0.06)',
    md: '0 4px 24px rgba(15, 23, 42, 0.06)',
    lg: '0 8px 32px rgba(15, 23, 42, 0.10)',
    focus: '0 0 0 2px rgba(13, 110, 253, 0.15)',
    card: '0 1px 2px rgba(16, 24, 40, 0.06)',
    hero: '0 4px 24px rgba(15, 23, 42, 0.06)',
    kpi: '0 1px 2px rgba(16, 24, 40, 0.06)'
  });
  global.CDSShadowTokens = CDSShadowTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSShadowTokens;
})(typeof window !== 'undefined' ? window : global);
