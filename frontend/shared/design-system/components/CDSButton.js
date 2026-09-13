(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const variant = o.variant || 'primary';
      const size = o.size || 'sm';
      const disabled = o.disabled || o.loading ? ' disabled' : '';
      const loading = o.loading ? ' cds-ui-btn--loading' : '';
      const icon = o.icon ? ((global.CDSUIHelpers || {}).iconHtml?.(o.icon) || '') + ' ' : '';
      const cls = 'cds-ui cds-ui-btn cds-ui-btn--' + esc(variant) + ' btn btn-' + esc(size) +
        (variant === 'primary' ? ' btn-primary' : '') +
        (variant === 'secondary' ? ' btn-secondary' : '') +
        (variant === 'outline' ? ' btn-outline-primary' : '') +
        (variant === 'ghost' ? ' btn-link' : '') +
        (variant === 'danger' ? ' btn-danger' : '') +
        (variant === 'warning' ? ' btn-warning' : '') +
        (variant === 'success' ? ' btn-success' : '') +
        (variant === 'info' ? ' btn-info' : '') +
        loading + (o.className ? ' ' + esc(o.className) : '');
      return '<button type="' + esc(o.type || 'button') + '" class="' + cls + '"' + disabled +
        (o.id ? ' id="' + esc(o.id) + '"' : '') +
        (o.attrs || '') + '>' +
        (o.loading ? ((global.CDSUIHelpers || {}).iconHtml?.('loading') || '') + ' ' : icon) +
        esc(o.label || '') + '</button>';
    }
    const CDSButton = { name: 'CDSButton', render };
    global.CDSButton = CDSButton;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSButton = CDSButton;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSButton;
})(typeof window !== 'undefined' ? window : global);
