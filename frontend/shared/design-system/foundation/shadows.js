(function (global) {
  'use strict';

  const CDSShadows = Object.freeze({ ...(global.CDSShadowTokens || {}) });
  global.CDSShadows = CDSShadows;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSShadows;
})(typeof window !== 'undefined' ? window : global);
