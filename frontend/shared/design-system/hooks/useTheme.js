(function (global) {
  'use strict';

  function useTheme() {
    return {
      theme: global.CDSTheme || null,
      apply: () => global.CDSTheme?.applyToDocument?.() === true,
      tokens: () => global.CDSTheme?.tokens?.() || {}
    };
  }
  global.useTheme = useTheme;

  if (typeof module !== 'undefined' && module.exports) module.exports = useTheme;
})(typeof window !== 'undefined' ? window : global);
