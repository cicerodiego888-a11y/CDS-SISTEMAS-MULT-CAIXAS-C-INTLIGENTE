(function (global) {
  'use strict';

  function useHealth() {
    return {
      render: (status, label) => global.CDSHealth?.render?.({ status, label }) || '',
      toneFor(status) {
        const s = String(status || '').toUpperCase();
        const map = global.CDSColors?.status || {};
        return map[s] || 'neutral';
      }
    };
  }
  global.useHealth = useHealth;

  if (typeof module !== 'undefined' && module.exports) module.exports = useHealth;
})(typeof window !== 'undefined' ? window : global);
