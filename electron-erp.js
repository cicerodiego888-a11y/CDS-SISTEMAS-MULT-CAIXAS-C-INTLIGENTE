const { app } = require('electron');
const { iniciarAplicacaoElectron } = require('./electron-common');

const prefixoDiagnostico = '[CDS-ELECTRON-DIAG]';

function registrarDiagnostico(evento, dados = {}) {
  const payload = {
    evento,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ...dados
  };
  console.error(`${prefixoDiagnostico} ${evento}`);
  console.error(`${prefixoDiagnostico} ${JSON.stringify(payload)}`);
}

function descreverErro(erro) {
  if (erro instanceof Error) {
    return { mensagem: erro.message, stack: erro.stack || null };
  }
  return { mensagem: String(erro), stack: null };
}

process.on('beforeExit', (code) => {
  registrarDiagnostico('beforeExit', { exitCode: code, mensagem: 'event loop esvaziou' });
});

process.on('exit', (code) => {
  registrarDiagnostico('exit', { exitCode: code, mensagem: 'processo encerrando' });
});

process.on('uncaughtException', (erro) => {
  registrarDiagnostico('uncaughtException', {
    exitCode: process.exitCode ?? 1,
    ...descreverErro(erro)
  });
});

process.on('unhandledRejection', (motivo) => {
  registrarDiagnostico('unhandledRejection', descreverErro(motivo));
});

registrarDiagnostico('electron-erp.js iniciado', {
  cwd: process.cwd(),
  dirname: __dirname,
  argv: process.argv,
  NODE_ENV: process.env.NODE_ENV || null,
  PORT: process.env.PORT || null
});

const whenReadyOriginal = app.whenReady.bind(app);
app.whenReady = (...args) => {
  registrarDiagnostico('app.whenReady iniciado');
  return whenReadyOriginal(...args).then((resultado) => {
    registrarDiagnostico('app.whenReady concluído');
    return resultado;
  });
};

app.on('browser-window-created', (_event, window) => {
  registrarDiagnostico('BrowserWindow criado', {
    urlInicial: window.webContents.getURL() || null
  });

  const loadURLOriginal = window.loadURL.bind(window);
  window.loadURL = (url, options) => {
    registrarDiagnostico('loadURL utilizado', { url });
    return loadURLOriginal(url, options);
  };

  const loadFileOriginal = window.loadFile.bind(window);
  window.loadFile = (filePath, options) => {
    registrarDiagnostico('loadFile utilizado', { filePath });
    return loadFileOriginal(filePath, options);
  };

  window.webContents.on('did-finish-load', () => {
    registrarDiagnostico('did-finish-load', { url: window.webContents.getURL() });
  });

  window.webContents.on('did-fail-load', (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
    registrarDiagnostico('did-fail-load', {
      errorCode,
      errorDescription,
      url: validatedURL,
      isMainFrame,
      mensagem: errorDescription
    });
  });

  window.webContents.on('render-process-gone', (_goneEvent, details) => {
    registrarDiagnostico('render-process-gone', {
      mensagem: details && details.reason ? String(details.reason) : 'render-process-gone',
      details
    });
  });

  window.on('closed', () => {
    registrarDiagnostico('BrowserWindow closed', { mensagem: 'janela fechada' });
  });
});

process.env.CDS_APP_MODULO = process.env.CDS_APP_MODULO || 'erp';

iniciarAplicacaoElectron({
  tituloJanela: 'CDS Sistemas - Plataforma Inteligente de Gestão',
  modulo: 'erp'
});
