(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const label = o.labelDomain
        ? ((global.CDSUIHelpers || {}).labelOr?.(o.label, o.labelDomain) || o.label)
        : (o.label || '');
      const tone = o.tone || 'ok';
      return '<div class="cds-ui cds-ui-kpi cds-cfg-kpi">' +
        '<div class="cds-ui-kpi__head cds-cfg-kpi__head">' +
        '<p class="cds-ui-kpi__label cds-cfg-kpi__label">' + esc(label) + '</p>' +
        '<span class="cds-ui-dot cds-cfg-dot" data-tone="' + esc(tone) + '"></span>' +
        '</div>' +
        '<p class="cds-ui-kpi__value cds-cfg-kpi__value">' + (o.valueHtml != null ? o.valueHtml : esc(o.value || '—')) + '</p>' +
        (o.detail ? '<p class="cds-ui-kpi__detail cds-cfg-kpi__detail">' + esc(o.detail) + '</p>' : '') +
        '</div>';
    }
    const CDSKPI = { name: 'CDSKPI', render };
    global.CDSKPI = CDSKPI;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSKPI = CDSKPI;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSKPI;
})(typeof window !== 'undefined' ? window : global);
