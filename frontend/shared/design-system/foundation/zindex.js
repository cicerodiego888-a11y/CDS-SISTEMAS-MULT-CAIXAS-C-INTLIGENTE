(function (global) {
  'use strict';

  const CDSZIndex = Object.freeze({ ...(global.CDSZIndexTokens || {}) });
  global.CDSZIndex = CDSZIndex;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSZIndex;
})(typeof window !== 'undefined' ? window : global);
