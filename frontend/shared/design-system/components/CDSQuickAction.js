(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      return global.CDSButton.render(Object.assign({ variant: 'outline', size: 'sm' }, o));
    }
    const CDSQuickAction = { name: 'CDSQuickAction', render };
    global.CDSQuickAction = CDSQuickAction;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSQuickAction = CDSQuickAction;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSQuickAction;
})(typeof window !== 'undefined' ? window : global);
