(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const items = (o.items || []).map((e) =>
        '<li class="cds-ui-timeline__item">' +
        '<span class="cds-ui-timeline__time">' + esc(e.time || '—') + '</span>' +
        '<span class="cds-ui-timeline__content"><strong>' + esc(e.title || '') + '</strong> ' +
        '<span class="text-muted">' + esc(e.meta || '') + '</span></span></li>'
      ).join('');
      return global.CDSCard.render({
        titleHtml: ((global.CDSUIHelpers || {}).iconHtml?.('stream') || '') + ' ' + esc(o.title || 'Timeline'),
        bodyHtml: items
          ? '<ul class="cds-ui-timeline cds-cfg-note">' + items + '</ul>'
          : '<p class="cds-ui-hint cds-cfg-hint">' + esc(o.empty || 'Sem eventos.') + '</p>'
      });
    }
    const CDSTimeline = { name: 'CDSTimeline', render };
    global.CDSTimeline = CDSTimeline;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSTimeline = CDSTimeline;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTimeline;
})(typeof window !== 'undefined' ? window : global);
