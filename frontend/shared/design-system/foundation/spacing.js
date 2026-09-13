(function (global) {
  'use strict';

  const CDSSpacing = Object.freeze({ ...(global.CDSSpacingTokens || {}) });
  global.CDSSpacing = CDSSpacing;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSpacing;
})(typeof window !== 'undefined' ? window : global);
