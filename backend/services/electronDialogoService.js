function isElectronRuntime() {
  return Boolean(process.versions && process.versions.electron);
}

function obterJanelaAtiva(event) {
  if (!isElectronRuntime()) {
    return null;
  }

  const { BrowserWindow } = require('electron');

  if (event && event.sender) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      return win;
    }
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }

  const globalWin = global.mainWindow;
  if (globalWin && !globalWin.isDestroyed()) {
    return globalWin;
  }

  return BrowserWindow.getAllWindows().find((win) => win && !win.isDestroyed()) || null;
}

/**
 * Interpreta o retorno de dialog.showOpenDialogSync (string[] | undefined).
 * Extraído para testes unitários sem depender do Electron.
 */
function interpretarRetornoShowOpenDialogSync(paths) {
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return { sucesso: false, cancelado: true };
  }
  const caminho = String(paths[0] || '').trim();
  if (!caminho) {
    return { sucesso: false, cancelado: true };
  }
  return { sucesso: true, caminho };
}

function selecionarPastaBackup(event) {
  if (!isElectronRuntime()) {
    return { sucesso: false, erro: 'NOT_ELECTRON' };
  }

  const { dialog, app } = require('electron');
  const win = obterJanelaAtiva(event);

  if (win) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  }

  if (typeof app.focus === 'function') {
    app.focus({ steal: true });
  }

  // showOpenDialogSync retorna string[] | undefined — NÃO { canceled, filePaths }
  const paths = dialog.showOpenDialogSync(win || undefined, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selecione a pasta de backup',
    buttonLabel: 'Selecionar pasta'
  });

  const resultado = interpretarRetornoShowOpenDialogSync(paths);
  if (resultado.sucesso) {
    console.log('[BACKUP CONFIG] Pasta selecionada:', resultado.caminho);
  }
  return resultado;
}

/**
 * RC14.15.19 — ShellExecute via Electron (abre EXE/pasta com UAC do Windows).
 * @param {string} caminhoAbs
 * @returns {Promise<{ sucesso: boolean, erro?: string, caminho?: string }>}
 */
async function abrirCaminhoComShell(caminhoAbs) {
  if (!isElectronRuntime()) {
    return { sucesso: false, erro: 'NOT_ELECTRON' };
  }
  const { shell } = require('electron');
  const caminho = String(caminhoAbs || '').trim();
  if (!caminho) {
    return { sucesso: false, erro: 'Caminho vazio' };
  }
  const erro = await shell.openPath(caminho);
  if (erro) {
    return { sucesso: false, erro: String(erro), caminho };
  }
  return { sucesso: true, caminho };
}

module.exports = {
  isElectronRuntime,
  selecionarPastaBackup,
  interpretarRetornoShowOpenDialogSync,
  abrirCaminhoComShell
};
