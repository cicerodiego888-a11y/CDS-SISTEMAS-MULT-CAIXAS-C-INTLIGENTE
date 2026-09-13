(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const icon = o.icon ? ((global.CDSUIHelpers || {}).iconHtml?.(o.icon) || '') : '';
      const badge = o.badgeHtml || '';
      return '<div class="cds-ui cds-ui-widget"' + (o.wrapAttr || '') + '>' +
        global.CDSCard.render({
          className: 'cds-ui-widget__card',
          attrs: o.id ? ' data-widget-id="' + esc(o.id) + '"' : '',
          titleHtml: icon + ' <span>' + esc(o.title || '') + '</span> ' + badge + (o.trailingHtml || ''),
          bodyHtml: o.bodyHtml || '',
          footerHtml: o.footerHtml || (o.hint ? '<p class="cds-ui-hint cds-cfg-hint">' + esc(o.hint) + '</p>' : '')
        }) + '</div>';
    }
    const CDSWidget = { name: 'CDSWidget', render };
    global.CDSWidget = CDSWidget;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSWidget = CDSWidget;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSWidget;
})(typeof window !== 'undefined' ? window : global);
