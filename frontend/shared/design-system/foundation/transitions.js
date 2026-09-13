(function (global) {
  'use strict';

  const CDSTransitions = Object.freeze({
    fast: 'all 120ms ease',
    base: 'all 180ms ease',
    slow: 'all 280ms ease',
    color: 'color 120ms ease, background 120ms ease, border-color 120ms ease'
  });
  global.CDSTransitions = CDSTransitions;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTransitions;
})(typeof window !== 'undefined' ? window : global);
