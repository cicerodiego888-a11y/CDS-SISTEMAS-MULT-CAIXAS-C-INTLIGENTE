(function (global) {
  'use strict';

  const CDSBreakpoints = Object.freeze({
    mobile: 0,
    tablet: 768,
    notebook: 1024,
    desktop: 1280,
    wide: 1440,
    current() {
      const w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      if (w < 768) return 'mobile';
      if (w < 1024) return 'tablet';
      if (w < 1280) return 'notebook';
      if (w < 1440) return 'desktop';
      return 'wide';
    },
    matches(name) {
      return this.current() === name;
    }
  });
  global.CDSBreakpoints = CDSBreakpoints;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSBreakpoints;
})(typeof window !== 'undefined' ? window : global);
