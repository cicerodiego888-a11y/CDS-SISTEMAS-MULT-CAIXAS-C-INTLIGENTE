(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-recommendation cds-cfg-note">' +
        '<strong>' + esc(o.title || '') + '</strong> — ' + esc(o.description || '') +
        (o.actionsHtml || '') + '</div>';
    }
    const CDSRecommendation = { name: 'CDSRecommendation', render };
    global.CDSRecommendation = CDSRecommendation;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSRecommendation = CDSRecommendation;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSRecommendation;
})(typeof window !== 'undefined' ? window : global);
