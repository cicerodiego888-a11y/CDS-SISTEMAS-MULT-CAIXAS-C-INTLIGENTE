(function (global) {
  'use strict';

  const CDSTypographyTokens = Object.freeze({
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    heroTitle: '1.2rem',
    heroSub: '0.82rem',
    cardTitle: '0.78rem',
    kpiLabel: '0.7rem',
    kpiValue: '0.95rem',
    body: '0.875rem',
    hint: '0.72rem',
    badge: '0.68rem',
    weightBold: 700,
    weightSemi: 600,
    weightRegular: 400
  });
  global.CDSTypographyTokens = CDSTypographyTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTypographyTokens;
})(typeof window !== 'undefined' ? window : global);
