(function (global) {
  'use strict';

  function render(opts) {
    return global.CDSHero.render(opts || {});
  }
  const CDSPageHeader = { name: 'CDSPageHeader', render };
  global.CDSPageHeader = CDSPageHeader;
  (global.CDSUIComponents = global.CDSUIComponents || {}).CDSPageHeader = CDSPageHeader;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSPageHeader;
})(typeof window !== 'undefined' ? window : global);
