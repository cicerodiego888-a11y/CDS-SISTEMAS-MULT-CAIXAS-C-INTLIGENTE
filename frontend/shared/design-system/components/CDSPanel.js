(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-panel' + (o.active ? ' is-active' : '') + '" data-cds-pane="' + esc(o.id || '') + '">' +
        (o.bodyHtml || '') + '</div>';
    }
    const CDSPanel = { name: 'CDSPanel', render };
    global.CDSPanel = CDSPanel;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSPanel = CDSPanel;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSPanel;
})(typeof window !== 'undefined' ? window : global);
