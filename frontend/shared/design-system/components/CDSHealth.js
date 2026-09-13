(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const status = String(o.status || 'OK').toUpperCase();
      const toneMap = { OK: 'ok', ATENCAO: 'warn', CRITICO: 'error', ONLINE: 'ok', OFFLINE: 'neutral', PROCESSANDO: 'prep', SINCRONIZANDO: 'prep' };
      return '<div class="cds-ui cds-ui-health">' +
        global.CDSBadge.render({ text: status, tone: toneMap[status] || 'neutral' }) +
        (o.label ? ' <span class="cds-ui-health__label">' + esc(o.label) + '</span>' : '') +
        '</div>';
    }
    const CDSHealth = { name: 'CDSHealth', render };
    global.CDSHealth = CDSHealth;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSHealth = CDSHealth;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSHealth;
})(typeof window !== 'undefined' ? window : global);
