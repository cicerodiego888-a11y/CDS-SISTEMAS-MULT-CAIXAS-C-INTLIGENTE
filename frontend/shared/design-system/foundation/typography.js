(function (global) {
  'use strict';

  const CDSTypography = Object.freeze({ ...(global.CDSTypographyTokens || {}) });
  global.CDSTypography = CDSTypography;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTypography;
})(typeof window !== 'undefined' ? window : global);
