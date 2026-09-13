(function (global) {
  'use strict';

  const MotionResolver = {
    classFor(kind) { return global.CDSMotion?.classFor?.(kind) || 'cds-ui-anim--fade'; },
    duration(name) {
      const t = global.CDSMotionTokens || {};
      if (name === 'fast') return t.durationFast;
      if (name === 'slow') return t.durationSlow;
      return t.durationBase;
    }
  };
  global.MotionResolver = MotionResolver;

  if (typeof module !== 'undefined' && module.exports) module.exports = MotionResolver;
})(typeof window !== 'undefined' ? window : global);
