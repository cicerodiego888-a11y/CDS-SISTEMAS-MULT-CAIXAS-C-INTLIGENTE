(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-metric"><div class="text-muted" style="font-size:0.75rem;">' + esc(o.label || '') +
        '</div><div style="font-size:1.1rem;font-weight:700;">' + esc(o.value != null ? o.value : '—') + '</div></div>';
    }
    const CDSMetric = { name: 'CDSMetric', render };
    global.CDSMetric = CDSMetric;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSMetric = CDSMetric;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSMetric;
})(typeof window !== 'undefined' ? window : global);
