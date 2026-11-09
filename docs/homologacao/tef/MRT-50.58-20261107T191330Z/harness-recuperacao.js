'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const traceFile = process.env.MRT5058_TRACE_FILE;
function trace(etapa) {
  if (!traceFile) return;
  fs.appendFileSync(traceFile, `${new Date().toISOString()} ${etapa}\n`);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
trace('script-loaded');

const isolated = process.env.MRT5058_ISOLATED_USERDATA;
const original = process.env.MRT5058_ORIGINAL_USERDATA;
const keyFile = process.env.MRT5058_KEY_FILE;

function emitir(registro) {
  process.stdout.write(`${JSON.stringify(registro)}\n`);
}

function encerrar(codigo, extra) {
  emitir(Object.assign({
    sucesso: false,
    codigo,
    electron: process.versions.electron,
    conteudoExposto: false
  }, extra || {}));
  app.exit(1);
}

function caminhoDentro(diretorio, caminho) {
  const relativo = path.relative(path.resolve(diretorio), path.resolve(caminho));
  return relativo === '' || (!relativo.startsWith('..') && !path.isAbsolute(relativo));
}

if (process.versions.electron !== '22.3.27') {
  encerrar('ELECTRON_VERSION');
} else if (process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '1') {
  encerrar('GATE_ON');
} else if (!isolated || !original || !keyFile) {
  encerrar('PATHS');
} else if (path.resolve(isolated).toLowerCase() === path.resolve(original).toLowerCase()
    || caminhoDentro(original, isolated)
    || caminhoDentro(isolated, original)) {
  encerrar('USERDATA_OVERLAP');
} else {
  app.setName('cds-sistemas');
  app.setPath('userData', path.resolve(isolated));

  app.whenReady().then(() => {
    const efetivo = path.resolve(app.getPath('userData'));
    if (efetivo.toLowerCase() !== path.resolve(isolated).toLowerCase()) {
      encerrar('USERDATA_NOT_ISOLATED', { userDataPath: efetivo });
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      encerrar('SAFE_STORAGE_UNAVAILABLE', { userDataPath: efetivo });
      return;
    }

    let store;
    try {
      store = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    } catch (_) {
      encerrar('KEY_READ_FAILED', { userDataPath: efetivo });
      return;
    }
    if (!store || store.versao !== 1 || store.algoritmo !== 'electron-safeStorage'
        || typeof store.ciphertext !== 'string' || !store.ciphertext.length) {
      encerrar('KEY_STORE_FORMAT', { userDataPath: efetivo });
      return;
    }

    let segredo;
    try {
      segredo = safeStorage.decryptString(Buffer.from(store.ciphertext, 'base64'));
    } catch (error) {
      encerrar('DECRYPT_FAILED', {
        userDataPath: efetivo,
        errorName: error && error.name ? error.name : 'Error'
      });
      return;
    }

    const formato64Hex = /^[a-f0-9]{64}$/i.test(segredo || '');
    let fingerprint = null;
    if (formato64Hex) {
      fingerprint = crypto.createHash('sha256')
        .update(Buffer.from(segredo, 'hex'))
        .digest('hex')
        .slice(0, 16);
    }
    segredo = undefined;
    store = undefined;

    const carregados = Object.keys(require.cache);
    const registro = {
      sucesso: formato64Hex,
      codigo: formato64Hex ? 'RECOVERED' : 'FORMAT_INVALID',
      electron: process.versions.electron,
      appName: app.getName(),
      safeStorageAvailable: true,
      userDataPath: efetivo,
      originalUserDataPath: path.resolve(original),
      userDataIsolado: true,
      formato64Hex,
      fingerprint,
      fingerprintMethod: 'sha256-decrypted-key-bytes-truncated-16',
      fingerprintHistoricoCompativel: fingerprint === '1c6d56245ac4e501',
      conteudoExposto: false,
      chaveRecriptografada: false,
      nativeHostIniciado: false,
      dllCarregada: carregados.some((item) => /koffi|libdll-integracao-tef|DestaxaNative/i.test(item)),
      bancoAberto: carregados.some((item) => /sqlite|mercadao\.db/i.test(item)),
      gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || ''
    };
    if (process.env.MRT5058_RESULT_FILE) {
      fs.writeFileSync(process.env.MRT5058_RESULT_FILE, `${JSON.stringify(registro)}\n`);
    }
    trace('result-written');
    emitir(registro);
    app.exit(formato64Hex ? 0 : 2);
  }).catch((error) => {
    encerrar('READY_FAILED', { errorName: error && error.name ? error.name : 'Error' });
  });
}
