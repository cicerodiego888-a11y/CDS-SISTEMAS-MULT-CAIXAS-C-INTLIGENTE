(function (global) {
  'use strict';

  function useNotification() {
    return {
      notify: (msg, type, duration) => global.CDSNotification?.show?.(msg, type, duration),
      success: (msg) => global.CDSNotification?.show?.(msg, 'success'),
      error: (msg) => global.CDSNotification?.show?.(msg, 'error'),
      warning: (msg) => global.CDSNotification?.show?.(msg, 'warning'),
      info: (msg) => global.CDSNotification?.show?.(msg, 'info')
    };
  }
  global.useNotification = useNotification;

  if (typeof module !== 'undefined' && module.exports) module.exports = useNotification;
})(typeof window !== 'undefined' ? window : global);
