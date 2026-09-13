(function (global) {
  'use strict';

  const CDSRadius = Object.freeze({ ...(global.CDSRadiusTokens || {}) });
  global.CDSRadius = CDSRadius;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSRadius;
})(typeof window !== 'undefined' ? window : global);
