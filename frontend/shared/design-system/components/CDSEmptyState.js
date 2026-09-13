(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const kind = o.kind || 'empty';
      const icons = { empty: 'empty', search: 'fa-search', error: 'error', permission: 'fa-lock', offline: 'offline' };
      const icon = (global.CDSUIHelpers || {}).iconHtml?.(icons[kind] || 'empty') || '';
      return '<div class="cds-ui cds-ui-empty">' +
        '<div class="cds-ui-empty__icon">' + icon + '</div>' +
        '<h3 class="cds-ui-empty__title">' + esc(o.title || 'Sem dados') + '</h3>' +
        (o.description ? '<p class="cds-ui-empty__desc">' + esc(o.description) + '</p>' : '') +
        (o.actionsHtml || '') + '</div>';
    }
    const CDSEmptyState = { name: 'CDSEmptyState', render };
    global.CDSEmptyState = CDSEmptyState;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSEmptyState = CDSEmptyState;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSEmptyState;
})(typeof window !== 'undefined' ? window : global);
