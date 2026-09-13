/**
 * RC3.5.1 — Registro centralizado dos handlers IPC do Portal Nacional.
 * Usado por electron-common.js e electron.js para evitar divergência de canais.
 *
 * @module electron-registrar-portal-nfe
 */

'use strict';

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {() => Electron.BrowserWindow|null} obterMainWindow
 * @returns {boolean}
 */
function registrarPortalNfeHandlers(ipcMain, obterMainWindow) {
  try {
    const portalNfe = require('./electron-portal-nfe');
    portalNfe.registrarHandlersIpc(ipcMain, obterMainWindow);
    console.log(
      '[PortalNFe] Handlers IPC registrados:',
      'portal-nfe-abrir, portal-nfe-fechar, portal-nfe-status, portal-nfe-download'
    );
    return true;
  } catch (error) {
    console.error('[PortalNFe] Falha ao registrar IPC:', error.stack || error.message);
    return false;
  }
}

module.exports = { registrarPortalNfeHandlers };
