'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

if (process.versions.electron) {
  executarInstanciaElectron().catch((error) => {
    process.stderr.write(`${error.code || error.name || 'PROBE_FAILED'}\n`);
    process.exitCode = 1;
    require('electron').app.quit();
  });
} else {
  executarMatriz().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

async function executarInstanciaElectron() {
  const { app, safeStorage } = require('electron');
  const role = process.env.MRT34_ROLE;
  const mode = process.env.MRT34_MODE;
  const userData = process.env.MRT34_USER_DATA;
  const keyStoreDir = process.env.MRT34_KEY_STORE_DIR;

  if (process.env.DB_DIR || !userData || !keyStoreDir
      || !['write', 'read'].includes(mode)) {
    throw new Error('PROBE_CONFIGURATION_INVALID');
  }

  app.setPath('userData', userData);
  await app.whenReady();

  const result = {
    role,
    electron: process.versions.electron,
    appName: app.getName(),
    appSetNameAvailable: typeof app.setName === 'function',
    userDataPath: app.getPath('userData'),
    userDataPathMatches: app.getPath('userData') === userData,
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    localRoundTrip: false,
    operationSucceeded: false,
    sessionName: process.env.SESSIONNAME || null,
    tokenFingerprint: obterTokenFingerprint()
  };
  if (!result.safeStorageAvailable) throw new Error('SAFE_STORAGE_UNAVAILABLE');

  const sample = crypto.randomBytes(32).toString('hex');
  result.localRoundTrip = safeStorage.decryptString(
    safeStorage.encryptString(sample)
  ) === sample;

  const { KEY_FILENAME, provisionarChaveTef } = require(
    path.join(root, 'backend', 'services', 'tef', 'tefSigningKeyProvisioner')
  );
  const evidence = require(path.join(
    root,
    'backend',
    'services',
    'tef',
    'tefReconciliationEvidence'
  ));
  const storePath = path.join(keyStoreDir, KEY_FILENAME);
  try {
    const outcome = await provisionarChaveTef({
      safeStorage,
      dbDir: keyStoreDir,
      env: process.env
    });
    const key = process.env.TEF_ENCRYPTION_KEY;
    result.provisionOrigin = outcome.origem;
    result.keyFormatValid = /^[a-f0-9]{64}$/i.test(key || '');
    result.storeExcludesPlaintextKey = !fs.readFileSync(storePath, 'utf8').includes(key || '');
    result.databaseAbsent = !fs.existsSync(path.join(keyStoreDir, 'mercadao.db'));
    result.publicKeyFingerprint = crypto.createHash('sha256')
      .update(evidence.obterChavePublica())
      .digest('hex');
    result.operationSucceeded = result.keyFormatValid
      && result.storeExcludesPlaintextKey
      && result.databaseAbsent;
  } catch (error) {
    result.provisionErrorCode = error.code || error.name || null;
    result.operationSucceeded = false;
  }

  process.stdout.write(`${JSON.stringify(result)}\n`, () => app.quit());
}

function obterTokenFingerprint() {
  const { execFileSync } = require('child_process');
  const usuario = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true
  });
  const grupos = execFileSync('whoami.exe', ['/groups', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true
  });
  return crypto.createHash('sha256').update(`${usuario}\n${grupos}`).digest('hex');
}

async function executarMatriz() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(electronExe)) throw new Error('ELECTRON_22_3_27_NOT_FOUND');

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt50-34-safestorage-'));
  try {
    const userData = path.join(testRoot, 'shared-user-data');
    const mismatchUserData = path.join(testRoot, 'mismatched-user-data');
    const erpAppDir = path.join(testRoot, 'erp-app');
    const pdvAppDir = path.join(testRoot, 'pdv-app');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(mismatchUserData, { recursive: true });
    criarAppDiagnostico(erpAppDir);
    criarAppDiagnostico(pdvAppDir);

    const runPair = async (label, writerRole, writerApp, readerRole, readerApp) => {
      const keyStoreDir = path.join(testRoot, `${label}-key-store`);
      fs.mkdirSync(keyStoreDir, { recursive: true });
      const writer = await executarProcesso({
        electronExe,
        appDir: writerApp,
        role: writerRole,
        mode: 'write',
        userData,
        keyStoreDir
      });
      const reader = await executarProcesso({
        electronExe,
        appDir: readerApp,
        role: readerRole,
        mode: 'read',
        userData,
        keyStoreDir
      });
      return resumirPar(writer, reader);
    };

    const persistenciaLocalERP = await runPair(
      'erp-restart',
      'ERP',
      erpAppDir,
      'ERP',
      erpAppDir
    );
    const persistenciaLocalPDV = await runPair(
      'pdv-restart',
      'PDV',
      pdvAppDir,
      'PDV',
      pdvAppDir
    );
    const erpParaPdv = await runPair(
      'erp-to-pdv',
      'ERP',
      erpAppDir,
      'PDV',
      pdvAppDir
    );
    const pdvParaErp = await runPair(
      'pdv-to-erp',
      'PDV',
      pdvAppDir,
      'ERP',
      erpAppDir
    );

    const mismatchStoreDir = path.join(testRoot, 'profile-mismatch-key-store');
    fs.mkdirSync(mismatchStoreDir, { recursive: true });
    const mismatchWriter = await executarProcesso({
      electronExe,
      appDir: erpAppDir,
      role: 'ERP',
      mode: 'write',
      userData,
      keyStoreDir: mismatchStoreDir
    });
    const mismatchReader = await executarProcesso({
      electronExe,
      appDir: erpAppDir,
      role: 'ERP',
      mode: 'read',
      userData: mismatchUserData,
      keyStoreDir: mismatchStoreDir
    });

    const scenarios = {
      persistenciaLocalERP,
      persistenciaLocalPDV,
      erpParaPdv,
      pdvParaErp
    };
    const output = {
      electron: persistenciaLocalERP.electronVersion,
      packageAppName: persistenciaLocalERP.writerAppName,
      appSetNameAvailable: persistenciaLocalERP.appSetNameAvailable,
      sharedUserData: persistenciaLocalERP.sameUserDataPath
        && persistenciaLocalPDV.sameUserDataPath
        && erpParaPdv.sameUserDataPath
        && pdvParaErp.sameUserDataPath,
      sameWindowsToken: [
        persistenciaLocalERP,
        persistenciaLocalPDV,
        erpParaPdv,
        pdvParaErp
      ].every((scenario) => scenario.sameToken),
      sameSession: [
        persistenciaLocalERP,
        persistenciaLocalPDV,
        erpParaPdv,
        pdvParaErp
      ].every((scenario) => scenario.sameSession),
      results: Object.fromEntries(
        Object.entries(scenarios).map(([name, result]) => [name, result.success])
      ),
      profileMismatchControl: {
        sameAppName: mismatchWriter.appName === mismatchReader.appName,
        differentUserDataPaths: mismatchWriter.userDataPath !== mismatchReader.userDataPath,
        sameWindowsToken: mismatchWriter.tokenFingerprint === mismatchReader.tokenFingerprint,
        writerSucceeded: mismatchWriter.operationSucceeded,
        readerSucceeded: mismatchReader.operationSucceeded,
        readerErrorCode: mismatchReader.provisionErrorCode || null
      }
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

    if (!output.sharedUserData || !output.sameWindowsToken || !output.sameSession
        || Object.values(output.results).some((passed) => !passed)
        || !output.profileMismatchControl.writerSucceeded
        || output.profileMismatchControl.readerSucceeded
        || output.profileMismatchControl.readerErrorCode !== 'TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU') {
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}

function criarAppDiagnostico(appDir) {
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: 'cds-sistemas',
    version: '1.0.3',
    main: __filename
  }));
}

function executarProcesso({
  electronExe,
  appDir,
  role,
  mode,
  userData,
  keyStoreDir
}) {
  const { spawnSync } = require('child_process');
  const env = {
    ...process.env,
    DESTAXA_REAL_TRANSACTION_ENABLED: 'OFF',
    MRT34_ROLE: role,
    MRT34_MODE: mode,
    MRT34_USER_DATA: userData,
    MRT34_KEY_STORE_DIR: keyStoreDir
  };
  delete env.DB_DIR;
  delete env.TEF_ENCRYPTION_KEY;
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawnSync(electronExe, [appDir], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`${role}/${mode} Electron probe failed: ${(child.stderr || '').trim()}`);
  }
  const line = (child.stdout || '').split(/\r?\n/).find((value) => value.startsWith('{"role"'));
  if (!line) {
    throw new Error(`${role}/${mode} returned no diagnostic result: ${(child.stderr || '').trim()}`);
  }
  return JSON.parse(line);
}

function resumirPar(writer, reader) {
  return {
    success: writer.operationSucceeded
      && reader.operationSucceeded
      && writer.localRoundTrip
      && reader.localRoundTrip
      && reader.provisionOrigin === 'armazenamento-protegido'
      && writer.publicKeyFingerprint === reader.publicKeyFingerprint
      && writer.userDataPath === reader.userDataPath
      && writer.tokenFingerprint === reader.tokenFingerprint
      && writer.sessionName === reader.sessionName,
    electronVersion: writer.electron,
    writerAppName: writer.appName,
    readerAppName: reader.appName,
    appSetNameAvailable: writer.appSetNameAvailable,
    sameUserDataPath: writer.userDataPath === reader.userDataPath,
    sameToken: writer.tokenFingerprint === reader.tokenFingerprint,
    sameSession: writer.sessionName === reader.sessionName
  };
}
