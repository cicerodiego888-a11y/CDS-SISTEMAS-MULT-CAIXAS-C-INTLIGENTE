/**
 * CDS boot stamp — cache-bust de scripts lazy do ERP.
 * Mantido em arquivo externo para cumprir script-src 'self' (CSP).
 */
(function (global) {
  'use strict';
  if (global.CDS_BOOT_ID == null || global.CDS_BOOT_ID === '') {
    global.CDS_BOOT_ID = String(Date.now());
  }
})(typeof window !== 'undefined' ? window : globalThis);
