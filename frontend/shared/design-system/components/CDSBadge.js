(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const text = String(o.text || o.label || '');
      if (!text) return '';
      const toneMap = global.CDSColors?.badgeTone || {};
      let tone = o.tone || 'neutral';
      if (toneMap[tone]) tone = toneMap[tone];
      return '<span class="cds-ui cds-ui-badge cds-cfg-badge cds-cfg-badge--' + esc(tone) + '">' + esc(text) + '</span>';
    }
    const CDSBadge = { name: 'CDSBadge', render };
    global.CDSBadge = CDSBadge;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSBadge = CDSBadge;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSBadge;
})(typeof window !== 'undefined' ? window : global);
