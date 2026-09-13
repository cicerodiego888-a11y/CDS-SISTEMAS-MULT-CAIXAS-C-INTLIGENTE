(function (global) {
  'use strict';

    function show(message, type, duration) {
      const msg = String(message || '');
      const t = type || 'info';
      if (typeof global.showNotification === 'function') {
        global.showNotification(msg, t === 'danger' ? 'error' : t, duration);
        return true;
      }
      const host = typeof document !== 'undefined' ? document.getElementById('cds-ui-toast-host') : null;
      if (host) {
        const el = document.createElement('div');
        el.className = 'cds-ui-toast cds-ui-toast--' + t;
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => el.remove(), duration || 3500);
        return true;
      }
      if (typeof console !== 'undefined') console.info('[CDSNotification]', t, msg);
      return false;
    }
    function renderHost() {
      return '<div id="cds-ui-toast-host" class="cds-ui cds-ui-toast-host" aria-live="polite"></div>';
    }
    const CDSNotification = { name: 'CDSNotification', show, renderHost };
    global.CDSNotification = CDSNotification;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSNotification = CDSNotification;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSNotification;
})(typeof window !== 'undefined' ? window : global);
