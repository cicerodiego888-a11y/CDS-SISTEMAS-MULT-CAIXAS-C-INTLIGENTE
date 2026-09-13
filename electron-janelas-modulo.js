/**
 * Abertura de PDV/ERP em tela cheia no Electron.
 * window.open de comprovante continua pequeno; módulo nunca herda 420x720.
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const os = require('os');
const { resolverIconeJanela } = require('./electron-icon');

const janelasModulo = { pdv: null, erp: null };

function injetarHostnameEstacao(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const hostname = os.hostname();
  const script = `(function(){try{var h=${JSON.stringify(hostname)};sessionStorage.setItem('cds_estacao_hostname',h);window.__CDS_ESTACAO_HOSTNAME__=h;}catch(e){}})();`;
  webContents.executeJavaScript(script, true).catch(() => {});
}

function aplicarJanelaModuloTelaCheia(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const area = screen.getPrimaryDisplay().workAreaSize;
    win.setAlwaysOnTop(false);
    win.setMinimumSize(1024, 640);
    win.setBounds({
      x: 0,
      y: 0,
      width: Math.max(area.width, 1024),
      height: Math.max(area.height, 640)
    });
    win.maximize();
    win.show();
    win.focus();
  } catch (_) {
    try {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false);
        win.maximize();
        win.show();
      }
    } catch (__) { /* ignore */ }
  }
}

function janelaAbertaEhModuloApp(details = {}) {
  const destino = String(details.url || '');
  const nome = String(details.frameName || '');
  if (nome === 'cds-pdv' || nome === 'cds-erp') return true;
  if (/[?&]modulo=pdv/i.test(destino) || /[?&]page=licenca/i.test(destino)) return true;
  return /\/(erp|pdv|login)(\/|\?|$)/i.test(destino);
}

function janelaAbertaEhComprovante(details = {}) {
  if (janelaAbertaEhModuloApp(details)) return false;
  const destino = String(details.url || '');
  const feats = String(details.features || '');
  if (/^data:/i.test(destino)) return true;
  if (/width\s*=\s*(3\d{2}|4[0-2]\d)/i.test(feats)) return true;
  return false;
}

function resolverUrlModulo(url, sender) {
  const bruto = String(url || '').trim();
  if (/^https?:\/\//i.test(bruto)) return bruto;
  let origin = 'http://127.0.0.1:3001';
  try {
    if (sender && typeof sender.getURL === 'function') {
      const atual = sender.getURL();
      if (atual && /^https?:/i.test(atual)) origin = new URL(atual).origin;
    }
  } catch (_) { /* ignore */ }
  const caminho = bruto
    ? (bruto.startsWith('/') ? bruto : `/${bruto}`)
    : '/erp';
  return origin + caminho;
}

function opcoesJanelaModulo(titulo) {
  let width = 1280;
  let height = 800;
  try {
    const area = screen.getPrimaryDisplay().workAreaSize;
    width = Math.max(area.width, 1280);
    height = Math.max(area.height, 800);
  } catch (_) { /* ignore */ }
  return {
    width,
    height,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: titulo,
    autoHideMenuBar: true,
    alwaysOnTop: false,
    icon: resolverIconeJanela(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  };
}

function registrarJanelaPrincipalComoModulo(modulo, win) {
  const tipo = String(modulo || '').toLowerCase() === 'pdv' ? 'pdv' : 'erp';
  if (!win) return;
  janelasModulo[tipo] = win;
  win.on('closed', () => {
    if (janelasModulo[tipo] === win) janelasModulo[tipo] = null;
  });
}

function abrirJanelaModuloApp({ url, modulo, sender } = {}) {
  const tipo = String(modulo || '').toLowerCase() === 'pdv' ? 'pdv' : 'erp';
  const absoluta = resolverUrlModulo(url || (tipo === 'pdv' ? '/pdv' : '/erp'), sender);
  const existente = janelasModulo[tipo];
  if (existente && !existente.isDestroyed()) {
    try {
      const atual = existente.webContents.getURL();
      if (absoluta && atual !== absoluta && !String(atual).startsWith(absoluta)) {
        existente.loadURL(absoluta);
      }
    } catch (_) { /* ignore */ }
    aplicarJanelaModuloTelaCheia(existente);
    return existente;
  }

  const titulo = tipo === 'pdv'
    ? 'CDS Sistemas - PDV'
    : 'CDS Sistemas - Plataforma Inteligente de Gestão';
  const nova = new BrowserWindow(opcoesJanelaModulo(titulo));
  janelasModulo[tipo] = nova;
  nova.on('closed', () => {
    if (janelasModulo[tipo] === nova) janelasModulo[tipo] = null;
  });
  configurarAberturaJanelas(nova);
  nova.webContents.on('did-finish-load', () => {
    injetarHostnameEstacao(nova.webContents);
    aplicarJanelaModuloTelaCheia(nova);
  });
  nova.loadURL(absoluta);
  aplicarJanelaModuloTelaCheia(nova);
  return nova;
}

function configurarAberturaJanelas(win) {
  if (!win || win.isDestroyed() || !win.webContents) return;

  win.webContents.setWindowOpenHandler((details) => {
    if (janelaAbertaEhComprovante(details || {})) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 420,
          height: 720,
          title: 'Comprovante',
          alwaysOnTop: true,
          autoHideMenuBar: true,
          modal: false,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      };
    }

    const destino = String((details && details.url) || '');
    const nome = String((details && details.frameName) || '');
    const modulo = nome === 'cds-pdv' || /\/pdv/i.test(destino) || /modulo=pdv/i.test(destino)
      ? 'pdv'
      : 'erp';
    const urlParaAbrir = destino && destino !== 'about:blank'
      ? destino
      : (modulo === 'pdv' ? '/pdv' : '/erp');

    setImmediate(() => {
      abrirJanelaModuloApp({
        url: urlParaAbrir,
        modulo,
        sender: win.webContents
      });
    });
    return { action: 'deny' };
  });

  win.webContents.on('did-create-window', (child, details) => {
    try {
      if (!child || child.isDestroyed()) return;
      if (janelaAbertaEhComprovante(details || {})) {
        child.setAlwaysOnTop(true);
        child.focus();
        return;
      }
      child.setAlwaysOnTop(false);
      aplicarJanelaModuloTelaCheia(child);
      injetarHostnameEstacao(child.webContents);
    } catch (_) { /* ignore */ }
  });
}

function registrarIpcAbrirModulo(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  try {
    ipcMain.removeHandler('abrir-modulo-app');
  } catch (_) { /* ignore */ }
  ipcMain.handle('abrir-modulo-app', (event, payload = {}) => {
    const win = abrirJanelaModuloApp({
      url: payload.url,
      modulo: payload.modulo,
      sender: event && event.sender
    });
    return { ok: true, id: win && !win.isDestroyed() ? win.id : null };
  });
}

function aplicarReflowNaJanelaOrigem(event) {
  const win = event && event.sender
    ? BrowserWindow.fromWebContents(event.sender)
    : null;
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return;
  }
  try {
    if (typeof win.webContents.invalidate === 'function') {
      win.webContents.invalidate();
    }
  } catch (_) { /* ignore */ }
}

function registrarIpcForcarReflow(ipcMain) {
  if (!ipcMain || typeof ipcMain.on !== 'function') return;
  ipcMain.removeAllListeners('forcar-reflow');
  ipcMain.on('forcar-reflow', (event) => {
    aplicarReflowNaJanelaOrigem(event);
  });
}

function obterJanelaOrigemComprovante(event) {
  const doSender = event && event.sender
    ? BrowserWindow.fromWebContents(event.sender)
    : null;
  if (doSender && !doSender.isDestroyed()) return doSender;
  if (janelasModulo.pdv && !janelasModulo.pdv.isDestroyed()) return janelasModulo.pdv;
  if (janelasModulo.erp && !janelasModulo.erp.isDestroyed()) return janelasModulo.erp;
  return null;
}

function nomeImpressoraTermicaValido(deviceName) {
  const nome = String(deviceName || '').trim();
  if (!nome) return null;
  const lower = nome.toLowerCase();
  if (lower === 'cupom' || lower === 'default' || lower === 'padrão' || lower === 'padrao') {
    return null;
  }
  if (
    /microsoft print to pdf|microsoft xps|onenote|fax|send to onenote|adobe pdf|foxit|cutepdf|pdf creator/i.test(nome)
  ) {
    return null;
  }
  return nome;
}

function devolverFocoJanela(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch (_) { /* ignore */ }
}

function registrarIpcAbrirComprovante(ipcMain) {
  if (!ipcMain || typeof ipcMain.on !== 'function') return;
  ipcMain.removeAllListeners('abrir-comprovante');
  ipcMain.on('abrir-comprovante', (event, html, options = {}) => {
    const {
      silent = false,
      autoFecharMs = 5000,
      htmlImpressao = null
    } = options;
    const origem = obterJanelaOrigemComprovante(event);
    const deviceName = nomeImpressoraTermicaValido(options.deviceName);

    const cupomWindow = new BrowserWindow({
      width: 380,
      height: 720,
      title: 'DANFE NFC-e',
      parent: origem || undefined,
      modal: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    const papelMatch = String(html || '').match(/danfe-(58|80)/);
    const papelMm = papelMatch ? papelMatch[1] : '80';
    const utilMm = papelMm === '58' ? '54' : '76';
    const htmlFinal = String(html || '').replace('</head>', `
    <style>
      @page { size: ${papelMm}mm auto; margin: 0; }
      html, body.danfe {
        width: ${utilMm}mm !important; max-width: ${utilMm}mm !important;
        margin: 0 auto !important;
        background: #fff !important; color: #000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .qr img { display: block !important; margin: 8px auto !important; object-fit: contain !important; image-rendering: pixelated !important; }
      table.items { width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
    </style>
  </head>`);

    let impressaoConcluida = false;
    let autoFecharTimer = null;

    function restaurarPdv() {
      devolverFocoJanela(origem);
    }

    function executarImpressao(callback) {
      if (!deviceName) {
        impressaoConcluida = true;
        if (typeof callback === 'function') callback();
        return;
      }

      const printOptions = {
        silent: true,
        printBackground: true,
        deviceName,
        margins: { marginType: 'none' }
      };

      const concluir = () => {
        impressaoConcluida = true;
        if (typeof callback === 'function') callback();
      };

      if (htmlImpressao) {
        const printWindow = new BrowserWindow({
          width: 380,
          height: 900,
          show: false,
          parent: origem || undefined,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(htmlImpressao))}`);
        printWindow.webContents.once('did-finish-load', async () => {
          await printWindow.webContents.executeJavaScript('new Promise(r => setTimeout(r, 400));');
          printWindow.webContents.print(printOptions, () => {
            if (!printWindow.isDestroyed()) printWindow.destroy();
            concluir();
          });
        });
        return;
      }

      cupomWindow.webContents.print(printOptions, concluir);
    }

    function fecharCupom() {
      if (autoFecharTimer) {
        clearTimeout(autoFecharTimer);
        autoFecharTimer = null;
      }
      if (!cupomWindow.isDestroyed()) {
        cupomWindow.destroy();
      }
      restaurarPdv();
    }

    cupomWindow.on('closed', () => {
      restaurarPdv();
    });

    cupomWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlFinal)}`);

    cupomWindow.webContents.once('did-finish-load', async () => {
      await cupomWindow.webContents.executeJavaScript('new Promise(r => setTimeout(r, 400));');

      if (silent) {
        executarImpressao(() => fecharCupom());
        return;
      }

      if (origem && !origem.isDestroyed()) {
        try {
          cupomWindow.setParentWindow(origem);
        } catch (_) { /* ignore */ }
      }
      cupomWindow.show();
      try { cupomWindow.moveTop(); } catch (_) { /* ignore */ }

      if (deviceName) {
        executarImpressao(() => {});
      } else {
        impressaoConcluida = true;
      }

      autoFecharTimer = setTimeout(() => {
        fecharCupom();
      }, Math.max(Number(autoFecharMs) || 5000, 1000));
    });
  });
}

module.exports = {
  aplicarJanelaModuloTelaCheia,
  janelaAbertaEhModuloApp,
  janelaAbertaEhComprovante,
  abrirJanelaModuloApp,
  registrarJanelaPrincipalComoModulo,
  configurarAberturaJanelas,
  registrarIpcAbrirModulo,
  registrarIpcForcarReflow,
  registrarIpcAbrirComprovante,
  aplicarReflowNaJanelaOrigem,
  nomeImpressoraTermicaValido,
  obterJanelaOrigemComprovante
};
