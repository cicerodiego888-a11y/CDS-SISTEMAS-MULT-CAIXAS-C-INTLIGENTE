(function (global) {
  'use strict';

  const CDSMotion = Object.freeze({
    ...(global.CDSMotionTokens || {}),
    classFor(kind) {
      const map = global.CDSAnimations || {};
      return map[kind] || map.fade || '';
    }
  });
  global.CDSMotion = CDSMotion;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSMotion;
})(typeof window !== 'undefined' ? window : global);
