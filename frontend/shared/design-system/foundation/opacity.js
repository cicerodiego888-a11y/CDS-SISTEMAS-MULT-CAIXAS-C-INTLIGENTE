(function (global) {
  'use strict';

  const CDSOpacity = Object.freeze({
    disabled: 0.55,
    muted: 0.72,
    overlay: 0.45,
    hint: 0.88,
    full: 1
  });
  global.CDSOpacity = CDSOpacity;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSOpacity;
})(typeof window !== 'undefined' ? window : global);
