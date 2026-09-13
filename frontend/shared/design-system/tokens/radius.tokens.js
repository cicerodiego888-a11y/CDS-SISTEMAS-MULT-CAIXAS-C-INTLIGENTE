(function (global) {
  'use strict';

  const CDSRadiusTokens = Object.freeze({
    sm: '8px',
    md: '10px',
    lg: '12px',
    pill: '999px',
    card: '10px',
    hero: '12px',
    kpi: '10px',
    badge: '999px',
    button: '8px'
  });
  global.CDSRadiusTokens = CDSRadiusTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSRadiusTokens;
})(typeof window !== 'undefined' ? window : global);
