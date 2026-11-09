'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const APP_NAME = 'cds-sistemas';
const EXPECTED_ELECTRON = '22.3.27';
const EXPECTED_LOCAL_STATE_SHA256 = '26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040';
const EXPECTED_KEY_SHA256 = '875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167';
const EXPECTED_KEY_FINGERPRINT = '1c6d56245ac4e501';
const DB_DIR = 'C:\\ProgramData\\MercantilFiscal\\dados';
const KEY_FILE = path.join(DB_DIR, '.tef-signing-key.v1');

if (process.versions.electron) {
  executarProcessoElectron().catch((error) => {
    process.stdout.write(`MRT5038_RESULT=${JSON.stringify({
      sucesso: false,
      codigo: error.code || error.name || 'MRT5038_PROBE_FAILED',
      etapa: error.etapa || 'electron-probe'
    })}\n`, () => require('electron').app.quit());
    process.exitCode = 1;
  });
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');

  test('recupera a chave original nos perfis ERP/PDV independentes e após reinício', {
    timeout: 120000
  }, async () => {
    assert.equal(process.platform, 'win32', 'a validação exige Windows DPAPI');
    const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
    assert.equal(fs.existsSync(electronExe), true, 'Electron 22.3.27 deve estar instalado');
    const sourcePath = process.env.CDS_TEF_LOCAL_STATE_SOURCE;
    assert.ok(sourcePath, 'informe a cópia restrita do Local State preservado');

    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const userData = {
      erp: path.join(appData, 'cds-sistemas-erp'),
      pdv: path.join(appData, 'cds-sistemas-pdv')
    };
    const sourceCandidate = path.join(
      os.homedir(),
      'AppData',
      'Local',
      'Temp',
      'CDS-MRT-50.25-validation-f066c8f6b5e743ceb635ce4a9d631181',
      'profiles',
      'erp-official',
      'Local State'
    );
    const currentProfileState = path.join(appData, 'cds-sistemas', 'Local State');
    const baseline = {
      key: sha256File(KEY_FILE),
      source: sha256File(sourcePath),
      sourceCandidate: sha256File(sourceCandidate),
      previousProfile: sha256File(currentProfileState)
    };

    assert.equal(baseline.key, EXPECTED_KEY_SHA256);
    assert.equal(baseline.source, EXPECTED_LOCAL_STATE_SHA256);
    assert.equal(baseline.sourceCandidate, EXPECTED_LOCAL_STATE_SHA256);
    assert.equal(userData.erp.toLowerCase() !== userData.pdv.toLowerCase(), true);

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt50-38-electron-probe-'));
    try {
      const erpApp = criarAppDiagnostico(path.join(tempRoot, 'erp-app'));
      const pdvApp = criarAppDiagnostico(path.join(tempRoot, 'pdv-app'));
      const inicial = await aguardarTodos([
        executarProcesso({ spawn, electronExe, appDir: erpApp, modulo: 'erp', userData: userData.erp, sourcePath }),
        executarProcesso({ spawn, electronExe, appDir: pdvApp, modulo: 'pdv', userData: userData.pdv, sourcePath })
      ]);

      const reinicio = await aguardarTodos([
        executarProcesso({ spawn, electronExe, appDir: erpApp, modulo: 'erp', userData: userData.erp, sourcePath }),
        executarProcesso({ spawn, electronExe, appDir: pdvApp, modulo: 'pdv', userData: userData.pdv, sourcePath })
      ]);

      for (let index = 0; index < 2; index += 1) {
        const role = index === 0 ? 'erp' : 'pdv';
        assertResultado(inicial[index], role, userData[role], EXPECTED_LOCAL_STATE_SHA256);
        assertResultado(reinicio[index], role, userData[role], EXPECTED_LOCAL_STATE_SHA256);
        assert.equal(reinicio[index].fingerprint, inicial[index].fingerprint);
        assert.equal(reinicio[index].origem, 'armazenamento-protegido');
      }

      assert.equal(inicial[0].fingerprint, EXPECTED_KEY_FINGERPRINT);
      assert.equal(inicial[1].fingerprint, EXPECTED_KEY_FINGERPRINT);
      assert.equal(inicial[0].fingerprint, inicial[1].fingerprint);
      assert.equal(inicial[0].userDataPath !== inicial[1].userDataPath, true);
      assert.equal(inicial.every((result) => result.electron === EXPECTED_ELECTRON), true);
      assert.equal(reinicio.every((result) => result.electron === EXPECTED_ELECTRON), true);

      const final = {
        key: sha256File(KEY_FILE),
        source: sha256File(sourcePath),
        sourceCandidate: sha256File(sourceCandidate),
        previousProfile: sha256File(currentProfileState)
      };
      assert.deepEqual(final, baseline);

      process.stdout.write(`${JSON.stringify({
        resultado: 'PASS',
        electron: EXPECTED_ELECTRON,
        fingerprint: EXPECTED_KEY_FINGERPRINT,
        perfis: {
          erp: { userData: userData.erp, inicial: inicial[0], reinicio: reinicio[0] },
          pdv: { userData: userData.pdv, inicial: inicial[1], reinicio: reinicio[1] }
        },
        hashesOriginaisInalterados: true,
        convivioIndependente: true
      })}\n`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

async function executarProcessoElectron() {
  const { app, safeStorage } = require('electron');
  const modulo = process.env.MRT5038_MODULE;
  const userDataPath = process.env.MRT5038_USER_DATA;
  const sourceLocalStatePath = process.env.CDS_TEF_LOCAL_STATE_SOURCE;
  if (!['erp', 'pdv'].includes(modulo)
      || !userDataPath
      || process.env.DB_DIR
      || process.env.DESTAXA_REAL_TRANSACTION_ENABLED !== '0') {
    throw criarErro('MRT5038_CONFIGURATION_INVALID');
  }

  const {
    configurarPerfilTef,
    EXPECTED_LOCAL_STATE_SHA256
  } = require(path.join(root, 'backend', 'services', 'tef', 'tefCryptoProfileProvisioner'));
  const perfil = configurarPerfilTef({
    app,
    modulo,
    sourceLocalStatePath
  });
  const statePath = path.join(perfil.userDataPath, 'Local State');
  const stateHashAntesReady = sha256File(statePath);
  await app.whenReady();
  const stateHashDepoisReady = sha256File(statePath);
  if (!safeStorage.isEncryptionAvailable()) {
    throw criarErro('SAFE_STORAGE_UNAVAILABLE');
  }

  let sqliteFallbackChamado = false;
  const sqlite3Bloqueado = {
    OPEN_READONLY: 1,
    Database() {
      sqliteFallbackChamado = true;
      throw criarErro('DATABASE_ACCESS_BLOCKED');
    }
  };
  const { provisionarChaveTef } = require(path.join(
    root,
    'backend',
    'services',
    'tef',
    'tefSigningKeyProvisioner'
  ));
  const evidenceModule = require(path.join(
    root,
    'backend',
    'services',
    'tef',
    'tefReconciliationEvidence'
  ));
  const provisionamento = await provisionarChaveTef({
    safeStorage,
    dbDir: DB_DIR,
    permitirGeracaoChave: false,
    sqlite3: sqlite3Bloqueado
  });
  const chaveEmMemoria = process.env.TEF_ENCRYPTION_KEY;
  const storeContents = fs.readFileSync(path.join(DB_DIR, '.tef-signing-key.v1'), 'utf8');
  const publicKeyFingerprint = crypto.createHash('sha256')
    .update(evidenceModule.obterChavePublica())
    .digest('hex')
    .slice(0, 16);
  const secretTextFingerprint = crypto.createHash('sha256')
    .update(chaveEmMemoria, 'utf8')
    .digest('hex')
    .slice(0, 16);
  const secretBytesFingerprint = crypto.createHash('sha256')
    .update(Buffer.from(chaveEmMemoria, 'hex'))
    .digest('hex')
    .slice(0, 16);
  const result = {
    sucesso: true,
    modulo,
    appName: app.getName(),
    electron: process.versions.electron,
    userDataPath: app.getPath('userData'),
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    sourceHash: EXPECTED_LOCAL_STATE_SHA256,
    stateHashAntesReady,
    stateHashDepoisReady,
    stateHashAntesSair: sha256File(statePath),
    localStateInstalado: perfil.localStateInstalado,
    keyFormatValid: /^[a-f0-9]{64}$/i.test(chaveEmMemoria || ''),
    keyPresentOnlyInMemory: Boolean(chaveEmMemoria) && !storeContents.includes(chaveEmMemoria),
    fingerprint: secretBytesFingerprint,
    fingerprintMethod: 'sha256-decrypted-key-bytes-truncated',
    fingerprintMatches: {
      publicKey: publicKeyFingerprint === EXPECTED_KEY_FINGERPRINT,
      keyHexText: secretTextFingerprint === EXPECTED_KEY_FINGERPRINT,
      keyBytes: secretBytesFingerprint === EXPECTED_KEY_FINGERPRINT
    },
    origem: provisionamento.origem,
    databaseFallbackInvoked: sqliteFallbackChamado,
    dbDirEnvironmentAbsent: !process.env.DB_DIR,
    destaxaGateDisabled: process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '0',
    backendNotLoaded: !Object.keys(require.cache).some((modulePath) =>
      /[\\/]backend[\\/]server\.js$/i.test(modulePath)),
    tefManagerNotLoaded: !Object.keys(require.cache).some((modulePath) =>
      /[\\/]backend[\\/]services[\\/]tef[\\/]TefManager\.js$/i.test(modulePath)),
    nativeHostNotLoaded: !Object.keys(require.cache).some((modulePath) =>
      /DestaxaNativeHost(Client)?\.js$/i.test(modulePath))
  };
  delete process.env.TEF_ENCRYPTION_KEY;
  result.keyClearedBeforeExit = !process.env.TEF_ENCRYPTION_KEY;
  result.safeStorageContextMatchesOrigin = stateHashAntesReady === EXPECTED_LOCAL_STATE_SHA256
    || stateHashDepoisReady === EXPECTED_LOCAL_STATE_SHA256;

  result.validations = {
    keyFormatValid: result.keyFormatValid,
    keyPresentOnlyInMemory: result.keyPresentOnlyInMemory,
    keyClearedBeforeExit: result.keyClearedBeforeExit,
    safeStorageContextMatchesOrigin: result.safeStorageContextMatchesOrigin,
    expectedFingerprint: result.fingerprint === EXPECTED_KEY_FINGERPRINT,
    storedKeySource: result.origem === 'armazenamento-protegido',
    noDatabaseFallback: !result.databaseFallbackInvoked,
    noDbDirEnvironment: result.dbDirEnvironmentAbsent,
    backendNotLoaded: result.backendNotLoaded,
    tefManagerNotLoaded: result.tefManagerNotLoaded,
    nativeHostNotLoaded: result.nativeHostNotLoaded,
    destaxaGateDisabled: result.destaxaGateDisabled
  };
  result.sucesso = Object.values(result.validations).every(Boolean);
  if (!result.sucesso) {
    process.exitCode = 1;
    process.stdout.write(`MRT5038_RESULT=${JSON.stringify(result)}\n`, () => app.quit());
    return;
  }
  process.stdout.write(`MRT5038_RESULT=${JSON.stringify(result)}\n`, () => app.quit());
}

function executarProcesso({ spawn, electronExe, appDir, modulo, userData, sourcePath }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CDS_TEF_LOCAL_STATE_SOURCE: sourcePath,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0',
      MRT5038_MODULE: modulo,
      MRT5038_USER_DATA: userData
    };
    delete env.DB_DIR;
    delete env.TEF_ENCRYPTION_KEY;
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExe, [appDir], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${modulo} Electron probe timed out`));
    }, 45000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      const line = stdout.split(/\r?\n/).find((value) => value.startsWith('MRT5038_RESULT='));
      if (!line) {
        reject(new Error(`${modulo} Electron probe failed (exit ${code}): ${sanitizarErro(stderr)}`));
        return;
      }
      try {
        const result = JSON.parse(line.slice('MRT5038_RESULT='.length));
        if (code !== 0 && result.sucesso) {
          reject(new Error(`${modulo} Electron probe exited with ${code} after success result`));
          return;
        }
        resolve(result);
      } catch (_) {
        reject(new Error(`${modulo} Electron probe returned invalid diagnostic JSON`));
      }
    });
  });
}

function criarAppDiagnostico(appDir) {
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: APP_NAME,
    version: '1.0.3',
    main: __filename
  }));
  return appDir;
}

function assertResultado(result, modulo, userDataPath, expectedSourceHash) {
  const assert = require('node:assert/strict');
  assert.equal(result.sucesso, true, JSON.stringify(result.validations || { codigo: result.codigo }));
  assert.equal(result.modulo, modulo);
  assert.equal(result.appName, APP_NAME);
  assert.equal(result.userDataPath, userDataPath);
  assert.equal(result.safeStorageAvailable, true);
  assert.equal(result.sourceHash, expectedSourceHash);
  assert.equal(result.keyFormatValid, true);
  assert.equal(result.keyPresentOnlyInMemory, true);
  assert.equal(result.keyClearedBeforeExit, true);
  assert.equal(result.databaseFallbackInvoked, false);
  assert.equal(result.dbDirEnvironmentAbsent, true);
  assert.equal(result.destaxaGateDisabled, true);
  assert.equal(result.backendNotLoaded, true);
  assert.equal(result.tefManagerNotLoaded, true);
  assert.equal(result.nativeHostNotLoaded, true);
  assert.equal(result.safeStorageContextMatchesOrigin, true);
}

async function aguardarTodos(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((result) => result.value);
}

function sha256File(filePath) {
  const contents = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex').toUpperCase();
}

function sanitizarErro(stderr) {
  return String(stderr || '')
    .replace(/MRT5038_DB_DIR=[^\s]+/g, 'MRT5038_DB_DIR=[redacted]')
    .slice(-1200);
}

function criarErro(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
