'use strict';

/**
 * RC3.16.4 — Auditoria temporária da camada Electron.
 * Objetivo: evidenciar origem, versão, cache e divergência de pacote (asar).
 */

const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');

const TAG = '[RC3.16.4][ELECTRON-AUDIT]';

const ARQUIVOS_CRITICOS_FRONTEND = [
  'frontend/shared/js/core.js',
  'frontend/erp/index.html',
  'frontend/erp/js/app.js',
  'frontend/erp/js/faturamento.js',
  'frontend/erp/js/pedidos.js',
  'frontend/erp/js/nfe-central.js',
  'frontend/erp/js/nfe-avulsa.js',
  'frontend/erp/js/nfe-operacional.js'
];

function raizApp() {
  return path.join(__dirname);
}

function existeNoPacote(relPosix) {
  const abs = path.join(raizApp(), ...relPosix.split('/'));
  try {
    return fs.existsSync(abs);
  } catch (_) {
    return false;
  }
}

function listarArquivosAusentes() {
  return ARQUIVOS_CRITICOS_FRONTEND.filter((rel) => !existeNoPacote(rel));
}

function metadadosPacote() {
  const pkgPath = path.join(raizApp(), 'package.json');
  let version = 'desconhecida';
  try {
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || version;
  } catch (_) {
    /* ignore */
  }

  const execPath = typeof process.execPath === 'string' ? process.execPath : '';
  const resourcesPath = process.resourcesPath || '';
  const rodandoDeAsar = /\.asar/i.test(__dirname) || /\.asar/i.test(resourcesPath);

  return {
    versionErp: version,
    versionElectron: process.versions.electron,
    versionChrome: process.versions.chrome,
    versionNode: process.versions.node,
    rodandoDeAsar,
    dirname: __dirname,
    resourcesPath,
    execPath,
    dbDir: process.env.DB_DIR || null,
    port: process.env.PORT || null
  };
}

function registrarAuditoriaStartup(extra = {}) {
  const meta = { ...metadadosPacote(), ...extra };
  const ausentes = listarArquivosAusentes();
  console.log(TAG, 'startup', JSON.stringify(meta, null, 2));
  console.log(TAG, 'arquivosCriticosAusentes', ausentes);

  if (ausentes.length) {
    console.error(
      TAG,
      'CAUSA PROVÁVEL: pacote Electron (asar/instalador) desatualizado em relação ao código-fonte.',
      'Arquivos ausentes no pacote:',
      ausentes.join(', ')
    );
  }

  return { meta, ausentes };
}

async function invalidarCachesSessao() {
  const sess = session.defaultSession;
  const resultado = {
    clearCache: false,
    clearStorageData: false,
    clearCodeCaches: false
  };

  try {
    await sess.clearCache();
    resultado.clearCache = true;
  } catch (err) {
    console.warn(TAG, 'clearCache falhou:', err && err.message ? err.message : err);
  }

  try {
    if (typeof sess.clearCodeCaches === 'function') {
      await sess.clearCodeCaches();
      resultado.clearCodeCaches = true;
    }
  } catch (err) {
    console.warn(TAG, 'clearCodeCaches falhou:', err && err.message ? err.message : err);
  }

  // Não limpa localStorage/token automaticamente (evita logout forçado).
  // Apenas registra que o storage de autenticação permanece por origem.
  console.log(TAG, 'cachesInvalidated', resultado);
  console.log(
    TAG,
    'notaStorage',
    'localStorage/sessionStorage/cookies permanecem por origin (127.0.0.1 !== localhost).'
  );

  return resultado;
}

function montarScriptAuditoriaRenderer(urlCarregada, meta) {
  const payload = JSON.stringify({
    urlCarregada,
    versionErp: meta.versionErp,
    versionElectron: meta.versionElectron,
    versionChrome: meta.versionChrome,
    versionNode: meta.versionNode,
    rodandoDeAsar: meta.rodandoDeAsar
  });

  return `(function(){
    try {
      var meta = ${payload};
      var snap = {
        meta: meta,
        href: String(location.href || ''),
        origin: String(location.origin || ''),
        pathname: String(location.pathname || ''),
        apiUrl: (typeof window.API_URL === 'string' ? window.API_URL : null),
        temElectronAPI: !!(window.electronAPI),
        tokenPresente: !!(localStorage.getItem('token')),
        localStorageKeys: Object.keys(localStorage || {}),
        sessionStorageKeys: Object.keys(sessionStorage || {}),
        configImplantacao: window.CONFIG_IMPLANTACAO || null,
        recursos: (window.CONFIG_IMPLANTACAO && window.CONFIG_IMPLANTACAO.recursos) || null
      };
      console.log('${TAG} renderer-snapshot', snap);
      window.__CDS_RC3164_AUDIT__ = snap;
    } catch (e) {
      console.error('${TAG} renderer-snapshot-erro', e && e.message ? e.message : e);
    }
  })();`;
}

function anexarAuditoriaNaJanela(browserWindow, urlCarregada, meta) {
  if (!browserWindow || browserWindow.isDestroyed()) return;

  const wc = browserWindow.webContents;

  wc.on('console-message', (_event, level, message, line, sourceId) => {
    if (String(message || '').includes('RC3.16.4') || level >= 2) {
      console.log(TAG, 'console', { level, message, line, sourceId });
    }
  });

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(TAG, 'did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  const injetar = () => {
    wc.executeJavaScript(montarScriptAuditoriaRenderer(urlCarregada, meta), true).catch((err) => {
      console.warn(TAG, 'falha ao injetar snapshot renderer:', err && err.message ? err.message : err);
    });

    // Segunda leitura após boot do ERP (CONFIG_IMPLANTACAO costuma chegar async).
    setTimeout(() => {
      if (browserWindow.isDestroyed()) return;
      wc.executeJavaScript(montarScriptAuditoriaRenderer(urlCarregada, meta), true).catch(() => {});
    }, 2500);
  };

  wc.on('did-finish-load', injetar);
}

function mensagemPacoteDesatualizado(ausentes) {
  if (!ausentes || !ausentes.length) return null;
  return [
    'RC3.16.4 — Pacote Electron desatualizado.',
    '',
    'O instalador/asar em execução não contém módulos presentes no código-fonte atual.',
    'Isso explica falhas exclusivas no Electron enquanto o navegador (fonte viva) funciona.',
    '',
    'Arquivos ausentes:',
    ...ausentes.map((f) => ` - ${f}`),
    '',
    'Ação: gerar novo instalador com npm run build:erp e reinstalar.'
  ].join('\n');
}

module.exports = {
  TAG,
  ARQUIVOS_CRITICOS_FRONTEND,
  listarArquivosAusentes,
  metadadosPacote,
  registrarAuditoriaStartup,
  invalidarCachesSessao,
  anexarAuditoriaNaJanela,
  mensagemPacoteDesatualizado
};
