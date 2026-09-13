(function (global) {
  'use strict';

  const ThemeResolver = {
    apply() { return global.CDSTheme?.applyToDocument?.() === true; },
    variables() { return global.CDSTheme?.cssVariables?.() || {}; },
    tokens() { return global.CDSTheme?.tokens?.() || {}; }
  };
  global.ThemeResolver = ThemeResolver;

  if (typeof module !== 'undefined' && module.exports) module.exports = ThemeResolver;
})(typeof window !== 'undefined' ? window : global);
