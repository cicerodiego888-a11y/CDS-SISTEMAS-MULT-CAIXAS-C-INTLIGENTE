(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const items = (o.items || []).map((t) =>
        '<button type="button" class="cds-ui-tab cds-cfg-nav__item' + (t.active ? ' is-active' : '') + '" data-cds-tab="' + esc(t.id) + '">' +
        (t.icon ? ((global.CDSUIHelpers || {}).iconHtml?.(t.icon) || '') : '') +
        '<span>' + esc(t.label) + '</span></button>'
      ).join('');
      return '<nav class="cds-ui cds-ui-tabs cds-cfg-nav" aria-label="' + esc(o.ariaLabel || 'Abas') + '">' + items + '</nav>';
    }
    const CDSTabs = { name: 'CDSTabs', render };
    global.CDSTabs = CDSTabs;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSTabs = CDSTabs;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTabs;
})(typeof window !== 'undefined' ? window : global);
