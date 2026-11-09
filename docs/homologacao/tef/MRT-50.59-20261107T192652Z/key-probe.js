'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const isolated = process.env.MRT5059_KEY_PROBE_USERDATA;
const keyFile = process.env.MRT5059_KEY_FILE;
const resultFile = process.env.MRT5059_KEY_PROBE_RESULT;

function writeResult(payload) {
  fs.writeFileSync(resultFile, `${JSON.stringify(payload)}\n`);
}

app.setName('cds-sistemas');
app.setPath('userData', path.resolve(isolated));

app.whenReady().then(() => {
  if (process.versions.electron !== '22.3.27') {
    writeResult({ sucesso: false, codigo: 'ELECTRON_VERSION' });
    app.exit(1);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    writeResult({ sucesso: false, codigo: 'SAFE_STORAGE_UNAVAILABLE' });
    app.exit(1);
    return;
  }
  const store = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  let segredo = safeStorage.decryptString(Buffer.from(store.ciphertext, 'base64'));
  const ok = /^[a-f0-9]{64}$/i.test(segredo || '');
  const fingerprint = ok
    ? crypto.createHash('sha256').update(Buffer.from(segredo, 'hex')).digest('hex').slice(0, 16)
    : null;
  segredo = undefined;
  writeResult({
    sucesso: ok,
    electron: process.versions.electron,
    userDataPath: app.getPath('userData'),
    fingerprint,
    fingerprintHistoricoCompativel: fingerprint === '1c6d56245ac4e501',
    conteudoExposto: false,
    nativeHostIniciado: false,
    dllCarregada: false
  });
  app.exit(ok ? 0 : 2);
}).catch((error) => {
  writeResult({ sucesso: false, codigo: 'READY_FAILED', errorName: error && error.name });
  app.exit(1);
});
