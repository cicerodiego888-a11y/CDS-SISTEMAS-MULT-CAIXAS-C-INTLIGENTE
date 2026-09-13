(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const variant = o.variant === 'kpi' ? ' cds-ui-grid--kpi' : (o.variant === 'widgets' ? ' cds-ui-grid--widgets' : '');
      return '<div class="cds-ui cds-ui-grid' + variant + '">' + (o.html || '') + '</div>';
    }
    const CDSGrid = { name: 'CDSGrid', render };
    global.CDSGrid = CDSGrid;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSGrid = CDSGrid;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSGrid;
})(typeof window !== 'undefined' ? window : global);
