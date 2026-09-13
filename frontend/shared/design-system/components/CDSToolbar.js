(function (global) {
  'use strict';

  function render(opts) {
    return '<div class="cds-ui cds-ui-toolbar">' + ((opts || {}).html || '') + '</div>';
  }
  const CDSToolbar = { name: 'CDSToolbar', render };
  global.CDSToolbar = CDSToolbar;
  (global.CDSUIComponents = global.CDSUIComponents || {}).CDSToolbar = CDSToolbar;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSToolbar;
})(typeof window !== 'undefined' ? window : global);
