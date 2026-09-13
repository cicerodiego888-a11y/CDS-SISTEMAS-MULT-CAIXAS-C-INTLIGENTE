(function (global) {
  'use strict';

  const CDSColors = Object.freeze({
    ...(global.CDSColorTokens || {}),
    status: Object.freeze({
      OK: 'success',
      ATENCAO: 'warning',
      CRITICO: 'danger',
      PROCESSANDO: 'processing',
      OFFLINE: 'offline',
      ONLINE: 'online',
      SINCRONIZANDO: 'processing'
    }),
    badgeTone: Object.freeze({
      success: 'ok', warning: 'warn', danger: 'error', info: 'info',
      neutral: 'neutral', processing: 'prep', offline: 'neutral',
      online: 'ok', readonly: 'neutral'
    })
  });
  global.CDSColors = CDSColors;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSColors;
})(typeof window !== 'undefined' ? window : global);
