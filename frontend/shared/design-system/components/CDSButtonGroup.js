(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      return '<div class="cds-ui cds-ui-btn-group">' + (o.html || '') + '</div>';
    }
    const CDSButtonGroup = { name: 'CDSButtonGroup', render };
    global.CDSButtonGroup = CDSButtonGroup;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSButtonGroup = CDSButtonGroup;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSButtonGroup;
})(typeof window !== 'undefined' ? window : global);
