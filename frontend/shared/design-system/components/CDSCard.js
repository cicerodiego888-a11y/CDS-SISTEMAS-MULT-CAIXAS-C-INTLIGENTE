(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const accent = o.accent ? ' cds-ui-card--accent-' + esc(o.accent) : '';
      const hl = o.highlight ? ' is-highlight' : '';
      return '<div class="cds-ui cds-ui-card cds-cfg-card' + accent + hl + (o.className ? ' ' + esc(o.className) : '') + '"' +
        (o.id ? ' id="' + esc(o.id) + '"' : '') +
        (o.attrs || '') + '>' +
        (o.title ? '<div class="cds-ui-card__title cds-cfg-card__title">' + (o.titleHtml || esc(o.title)) + '</div>' : '') +
        '<div class="cds-ui-card__body">' + (o.bodyHtml || '') + '</div>' +
        (o.footerHtml ? '<div class="cds-ui-card__footer">' + o.footerHtml + '</div>' : '') +
        '</div>';
    }
    const CDSCard = { name: 'CDSCard', render };
    global.CDSCard = CDSCard;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSCard = CDSCard;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSCard;
})(typeof window !== 'undefined' ? window : global);
