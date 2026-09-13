(function (global) {
  'use strict';

  const CDSZIndexTokens = Object.freeze({
    base: 1,
    dropdown: 100,
    sticky: 200,
    overlay: 900,
    modal: 1000,
    toast: 1100,
    loader: 1200
  });
  global.CDSZIndexTokens = CDSZIndexTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSZIndexTokens;
})(typeof window !== 'undefined' ? window : global);
