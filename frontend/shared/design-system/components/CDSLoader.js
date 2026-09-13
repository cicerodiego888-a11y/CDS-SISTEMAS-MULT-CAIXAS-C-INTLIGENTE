(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const variant = o.variant || 'spinner';
      if (variant === 'skeleton') {
        return '<div class="cds-ui cds-ui-skeleton" aria-hidden="true"><div class="cds-ui-skeleton__line"></div><div class="cds-ui-skeleton__line"></div><div class="cds-ui-skeleton__line short"></div></div>';
      }
      if (variant === 'overlay') {
        return '<div class="cds-ui cds-ui-loader-overlay"><div class="cds-ui-spinner"></div><p>' + esc(o.label || 'Carregando…') + '</p></div>';
      }
      if (variant === 'progress') {
        const pct = Math.max(0, Math.min(100, Number(o.value) || 0));
        return '<div class="cds-ui cds-ui-progress" role="progressbar" aria-valuenow="' + pct + '"><div class="cds-ui-progress__bar" style="width:' + pct + '%"></div></div>';
      }
      return '<div class="cds-ui cds-ui-loader"><div class="cds-ui-spinner"></div>' +
        (o.label ? '<span>' + esc(o.label) + '</span>' : '') + '</div>';
    }
    const CDSLoader = { name: 'CDSLoader', render };
    global.CDSLoader = CDSLoader;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSLoader = CDSLoader;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSLoader;
})(typeof window !== 'undefined' ? window : global);
