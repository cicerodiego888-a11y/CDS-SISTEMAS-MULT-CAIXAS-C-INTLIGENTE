(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const H = global.CDSUIHelpers || {};
      const esc = H.esc || ((v) => String(v ?? ''));
      const icon = o.icon ? (H.iconHtml?.(o.icon) || '') : '';
      const title = esc(o.labelDomain ? (H.labelOr?.(o.title, o.labelDomain) || o.title) : (o.title || ''));
      const sub = esc(o.subtitle || '');
      const actions = o.actionsHtml || '';
      const meta = o.metaHtml || '';
      return '<div class="cds-ui cds-ui-hero cds-cfg-hero' + (o.className ? ' ' + esc(o.className) : '') + '">' +
        '<h1 class="cds-ui-hero__title cds-cfg-hero__title">' + icon + ' ' + title + '</h1>' +
        (sub ? '<p class="cds-ui-hero__sub cds-cfg-hero__sub">' + sub + '</p>' : '') +
        (meta ? '<div class="cds-ui-hero__meta cds-cfg-hero__meta">' + meta + '</div>' : '') +
        (actions ? '<div class="cds-ui-hero__actions cds-cfg-hero__actions">' + actions + '</div>' : '') +
        '</div>';
    }
    const CDSHero = { name: 'CDSHero', render };
    global.CDSHero = CDSHero;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSHero = CDSHero;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSHero;
})(typeof window !== 'undefined' ? window : global);
