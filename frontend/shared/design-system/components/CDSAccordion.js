(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const items = (o.items || []).map((it, i) =>
        '<details class="cds-ui-accordion__item"' + (it.open ? ' open' : '') + '>' +
        '<summary>' + esc(it.title || ('Item ' + (i + 1))) + '</summary>' +
        '<div class="cds-ui-accordion__body">' + (it.bodyHtml || esc(it.body || '')) + '</div></details>'
      ).join('');
      return '<div class="cds-ui cds-ui-accordion">' + items + '</div>';
    }
    const CDSAccordion = { name: 'CDSAccordion', render };
    global.CDSAccordion = CDSAccordion;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSAccordion = CDSAccordion;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSAccordion;
})(typeof window !== 'undefined' ? window : global);
