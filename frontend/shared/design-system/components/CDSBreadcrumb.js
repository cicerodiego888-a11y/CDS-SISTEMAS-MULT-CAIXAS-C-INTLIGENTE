(function (global) {
  'use strict';

  function render(opts) {
    const o = opts || {};
    const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
    const items = (o.items || []).map((it, i, arr) =>
      (i < arr.length - 1
        ? '<a href="' + esc(it.href || '#') + '">' + esc(it.label) + '</a>'
        : '<span>' + esc(it.label) + '</span>')
    ).join(' <span class="cds-ui-breadcrumb__sep">/</span> ');
    return '<nav class="cds-ui cds-ui-breadcrumb" aria-label="Breadcrumb">' + items + '</nav>';
  }
  const CDSBreadcrumb = { name: 'CDSBreadcrumb', render };
  global.CDSBreadcrumb = CDSBreadcrumb;
  (global.CDSUIComponents = global.CDSUIComponents || {}).CDSBreadcrumb = CDSBreadcrumb;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSBreadcrumb;
})(typeof window !== 'undefined' ? window : global);
