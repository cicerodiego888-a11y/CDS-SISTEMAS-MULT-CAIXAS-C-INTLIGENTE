(function (global) {
  'use strict';

  function useBreakpoint() {
    const bp = global.CDSBreakpoints;
    return {
      current: () => bp?.current?.() || 'desktop',
      matches: (n) => bp?.matches?.(n) === true,
      isMobile: () => bp?.current?.() === 'mobile',
      isTablet: () => bp?.current?.() === 'tablet',
      breakpoints: bp || null
    };
  }
  global.useBreakpoint = useBreakpoint;

  if (typeof module !== 'undefined' && module.exports) module.exports = useBreakpoint;
})(typeof window !== 'undefined' ? window : global);
