(function (global) {
  'use strict';

  const CDSElevation = Object.freeze({
    flat: 0, raised: 1, overlay: 2, modal: 3,
    shadowFor(level) {
      const s = global.CDSShadowTokens || {};
      if (level >= 3) return s.lg;
      if (level === 2) return s.md;
      if (level === 1) return s.sm;
      return s.none;
    }
  });
  global.CDSElevation = CDSElevation;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSElevation;
})(typeof window !== 'undefined' ? window : global);
