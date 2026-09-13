(function (global) {
  'use strict';

  const CDSSpacingTokens = Object.freeze({
    xs: '0.25rem',
    sm: '0.45rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.35rem',
    '2xl': '1.75rem',
    cardPadding: '1rem 1.1rem',
    heroPadding: '1.1rem 1.35rem',
    kpiPadding: '0.75rem 0.85rem',
    sectionGap: '0.85rem',
    gridGap: '0.75rem'
  });
  global.CDSSpacingTokens = CDSSpacingTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSpacingTokens;
})(typeof window !== 'undefined' ? window : global);
