(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const sev = o.severityidade || o.tone || 'INFO';
      const badgeTone = sev === 'CRITICO' || sev === 'danger' ? 'error' : (sev === 'ATENCAO' || sev === 'warning' ? 'warn' : 'info');
      return global.CDSCard.render({
        titleHtml: global.CDSBadge.render({ text: sev, tone: badgeTone }) + ' ' + esc(o.title || ''),
        bodyHtml: '<p class="cds-ui-hint cds-cfg-hint">' + esc(o.description || '') + '</p>' +
          (o.meta ? '<p class="cds-cfg-note">' + esc(o.meta) + '</p>' : '') + (o.actionsHtml || '')
      });
    }
    const CDSAlert = { name: 'CDSAlert', render };
    global.CDSAlert = CDSAlert;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSAlert = CDSAlert;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSAlert;
})(typeof window !== 'undefined' ? window : global);
