(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<section class="cds-ui cds-ui-section">' +
        (o.title ? '<header class="cds-ui-section-header"><h2>' + esc(o.title) + '</h2>' +
        (o.subtitle ? '<p>' + esc(o.subtitle) + '</p>' : '') + '</header>' : '') +
        '<div class="cds-ui-section__body">' + (o.bodyHtml || '') + '</div></section>';
    }
    const CDSSection = { name: 'CDSSection', render };
    global.CDSSection = CDSSection;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSSection = CDSSection;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSection;
})(typeof window !== 'undefined' ? window : global);
