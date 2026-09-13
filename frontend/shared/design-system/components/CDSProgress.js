(function (global) {
  'use strict';

    function render(opts) {
      return global.CDSLoader.render(Object.assign({ variant: 'progress' }, opts || {}));
    }
    const CDSProgress = { name: 'CDSProgress', render };
    global.CDSProgress = CDSProgress;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSProgress = CDSProgress;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSProgress;
})(typeof window !== 'undefined' ? window : global);
