(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      return global.CDSBadge.render({ text: o.status || o.text, tone: o.tone || 'neutral' });
    }
    const CDSStatusChip = { name: 'CDSStatusChip', render };
    global.CDSStatusChip = CDSStatusChip;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSStatusChip = CDSStatusChip;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSStatusChip;
})(typeof window !== 'undefined' ? window : global);
