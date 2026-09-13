(function (global) {
  'use strict';

    function render(opts) {
      return '<hr class="cds-ui cds-ui-divider" />';
    }
    const CDSDivider = { name: 'CDSDivider', render };
    global.CDSDivider = CDSDivider;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSDivider = CDSDivider;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSDivider;
})(typeof window !== 'undefined' ? window : global);
