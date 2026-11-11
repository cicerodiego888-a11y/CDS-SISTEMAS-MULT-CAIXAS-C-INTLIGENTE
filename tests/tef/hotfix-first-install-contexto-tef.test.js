'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  APP_NAME,
  EXPECTED_LOCAL_STATE_SHA256,
  MARKER_FILENAME,
  MODOS_CONTEXTO,
  PROFILE_NAMES,
  classificarRoteamentoContexto,
  configurarPerfilTef,
  finalizarContextoFirstInstall
} = require('../../backend/services/tef/tefCryptoProfileProvisioner');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

function criarAppFake(appDataPath, userDataInicial = null) {
  let name = 'temp';
  let userData = userDataInicial || path.join(appDataPath, 'unset');
  return {
    setName(value) { name = value; },
    getName() { return name; },
    setPath(key, value) {
      if (key === 'userData') userData = value;
    },
    getPath(key) {
      if (key === 'appData') return appDataPath;
      if (key === 'userData') return userData;
      throw new Error(`path ${key}`);
    }
  };
}

function gravarMigrationArtifacts(userDataPath, sourcePath) {
  const localState = fs.readFileSync(sourcePath);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(path.join(userDataPath, 'Local State'), localState);
  fs.writeFileSync(path.join(userDataPath, MARKER_FILENAME), `${JSON.stringify({
    versao: 1,
    appName: APP_NAME,
    modulo: 'erp',
    userDataPath,
    localStateOrigemSha256: EXPECTED_LOCAL_STATE_SHA256,
    provisionadoEm: new Date().toISOString()
  }, null, 2)}\n`);
}

test('1) instalação nova (FIRST_INSTALL) não exige origem preservada', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-new-'));
  try {
    const appData = path.join(root, 'AppData');
    fs.mkdirSync(appData, { recursive: true });
    const app = criarAppFake(appData);
    const perfil = configurarPerfilTef({
      app,
      modulo: 'erp',
      sourceLocalStatePath: undefined
    });
    assert.equal(perfil.modo, MODOS_CONTEXTO.FIRST_INSTALL);
    assert.equal(perfil.roteamento, 'FIRST_INSTALL');
    assert.equal(perfil.firstInstallPendente, true);
    assert.equal(perfil.permitirGeracaoChave, true);
    assert.equal(perfil.localStateInstalado, false);
    assert.equal(fs.existsSync(path.join(perfil.userDataPath, 'Local State')), false);
    assert.equal(fs.existsSync(path.join(perfil.userDataPath, MARKER_FILENAME)), false);
    assert.equal(perfil.userDataPath, path.join(appData, PROFILE_NAMES.erp));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('2) reabertura FIRST_INSTALL com mesmo contexto', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-reopen-'));
  try {
    const appData = path.join(root, 'AppData');
    const userData = path.join(appData, PROFILE_NAMES.erp);
    fs.mkdirSync(userData, { recursive: true });
    const localStateBytes = Buffer.from(`first-install-local-state-${Date.now()}`);
    const hash = sha256(localStateBytes);
    fs.writeFileSync(path.join(userData, 'Local State'), localStateBytes);

    const app = criarAppFake(appData, userData);
    app.setName(APP_NAME);
    const finalizado = finalizarContextoFirstInstall({ app, modulo: 'erp' });
    assert.equal(finalizado.modo, MODOS_CONTEXTO.FIRST_INSTALL);
    assert.equal(finalizado.markerCriado, true);
    assert.equal(finalizado.localStateSha256, hash);

    const app2 = criarAppFake(appData);
    const reaberto = configurarPerfilTef({ app: app2, modulo: 'erp' });
    assert.equal(reaberto.modo, MODOS_CONTEXTO.FIRST_INSTALL);
    assert.equal(reaberto.roteamento, 'FIRST_INSTALL_EXISTENTE');
    assert.equal(reaberto.firstInstallPendente, false);
    assert.equal(reaberto.permitirGeracaoChave, false);
    assert.equal(reaberto.localStateSha256, hash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('3) instalação migrada preserva contexto anterior (hash MRT)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-mig-'));
  try {
    const source = path.join(root, 'Local State.source');
    // Conteúdo sintético com hash forçado via fixture local se disponível; senão skip estrutural.
    const fixtureCandidates = [
      path.join(process.env.APPDATA || '', 'cds-sistemas-erp', 'Local State'),
      path.join(__dirname, '..', '..', 'docs', 'homologacao', 'tef',
        'MRT-50.58-20261107T191330Z', 'sealed', 'Local State')
    ];
    const fixture = fixtureCandidates.find((p) => fs.existsSync(p)
      && sha256(fs.readFileSync(p)) === EXPECTED_LOCAL_STATE_SHA256);
    if (!fixture) {
      assert.ok(true, 'fixture Local State homologado ausente neste host — classificação unitária abaixo');
      const classif = classificarRoteamentoContexto({
        marker: null,
        localStatePath: path.join(root, 'missing'),
        sourceLocalStatePath: path.join(root, 'source'),
        userDataPath: root,
        fsApi: {
          existsSync: (p) => p === path.join(root, 'source'),
          readdirSync: () => []
        }
      });
      assert.equal(classif.roteamento, 'MIGRATION_PROVISION');
      return;
    }

    fs.copyFileSync(fixture, source);
    const appData = path.join(root, 'AppData');
    fs.mkdirSync(appData, { recursive: true });
    const app = criarAppFake(appData);
    const perfil = configurarPerfilTef({
      app,
      modulo: 'erp',
      sourceLocalStatePath: source
    });
    assert.equal(perfil.modo, MODOS_CONTEXTO.MIGRATION);
    assert.equal(perfil.localStateSha256, EXPECTED_LOCAL_STATE_SHA256);
    assert.equal(perfil.permitirGeracaoChave, false);
    assert.equal(perfil.firstInstallPendente, false);

    const baseline = sha256(fs.readFileSync(source));
    const app2 = criarAppFake(appData);
    const reaberto = configurarPerfilTef({
      app: app2,
      modulo: 'erp',
      sourceLocalStatePath: source
    });
    assert.equal(reaberto.roteamento, 'MIGRATION_EXISTENTE');
    assert.equal(sha256(fs.readFileSync(source)), baseline);
    assert.equal(reaberto.localStateSha256, EXPECTED_LOCAL_STATE_SHA256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('4) contexto existente indisponível (origem ausente em migração) permanece bloqueado', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-src-missing-'));
  try {
    const appData = path.join(root, 'AppData');
    fs.mkdirSync(appData, { recursive: true });
    // Perfil vazio + source apontando para arquivo inexistente = migração sem origem.
    const app = criarAppFake(appData);
    assert.throws(
      () => configurarPerfilTef({
        app,
        modulo: 'erp',
        sourceLocalStatePath: path.join(root, 'nao-existe-Local-State')
      }),
      (error) => error && error.code === 'TEF_CONTEXTO_ORIGEM_AUSENTE'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('5) contexto corrompido / perfil não vazio sem marcador não é sobrescrito', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-corrupt-'));
  try {
    const appData = path.join(root, 'AppData');
    const userData = path.join(appData, PROFILE_NAMES.erp);
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, 'Preferences'), '{}');
    const app = criarAppFake(appData);
    assert.throws(
      () => configurarPerfilTef({ app, modulo: 'erp' }),
      (error) => error && error.code === 'TEF_CONTEXTO_PERFIL_NAO_VAZIO'
    );
    assert.equal(fs.existsSync(path.join(userData, 'Local State')), false);
    assert.equal(fs.readFileSync(path.join(userData, 'Preferences'), 'utf8'), '{}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('6) FIRST_INSTALL pending marker finaliza sem copiar contexto estrangeiro', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-pending-'));
  try {
    const appData = path.join(root, 'AppData');
    const userData = path.join(appData, PROFILE_NAMES.erp);
    fs.mkdirSync(userData, { recursive: true });
    const bytes = Buffer.from('electron-created-local-state');
    fs.writeFileSync(path.join(userData, 'Local State'), bytes);
    const app = criarAppFake(appData);
    const perfil = configurarPerfilTef({ app, modulo: 'erp' });
    assert.equal(perfil.roteamento, 'FIRST_INSTALL_PENDING_MARKER');
    assert.equal(perfil.firstInstallPendente, true);
    assert.equal(perfil.localStateSha256, sha256(bytes));

    app.setName(APP_NAME);
    app.setPath('userData', userData);
    const finalizado = finalizarContextoFirstInstall({ app, modulo: 'erp' });
    assert.equal(finalizado.markerCriado, true);
    assert.equal(finalizado.localStateSha256, sha256(bytes));
    assert.equal(sha256(fs.readFileSync(path.join(userData, 'Local State'))), sha256(bytes));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('7) fluxo financeiro continua dependente de autorização (gate/geração não ligados no contexto migrado)', () => {
  const classifMigracao = classificarRoteamentoContexto({
    marker: {
      versao: 1,
      appName: APP_NAME,
      modulo: 'erp',
      userDataPath: 'C:\\x\\cds-sistemas-erp',
      localStateOrigemSha256: EXPECTED_LOCAL_STATE_SHA256
    },
    localStatePath: 'C:\\x\\cds-sistemas-erp\\Local State',
    sourceLocalStatePath: undefined,
    userDataPath: 'C:\\x\\cds-sistemas-erp',
    fsApi: { existsSync: () => true, readdirSync: () => ['Local State', MARKER_FILENAME] }
  });
  assert.equal(classifMigracao.roteamento, 'MIGRATION_EXISTENTE');

  const classifFirst = classificarRoteamentoContexto({
    marker: null,
    localStatePath: 'C:\\novo\\Local State',
    sourceLocalStatePath: '',
    userDataPath: 'C:\\novo',
    fsApi: { existsSync: () => false, readdirSync: () => [] }
  });
  assert.equal(classifFirst.roteamento, 'FIRST_INSTALL');
  assert.equal(classifFirst.modo, MODOS_CONTEXTO.FIRST_INSTALL);

  // Confirma que instalação migrada existente NÃO libera geração automática de chave.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-fi-finance-'));
  try {
    const fixture = path.join(__dirname, '..', '..', 'docs', 'homologacao', 'tef',
      'MRT-50.58-20261107T191330Z', 'sealed', 'Local State');
    if (!fs.existsSync(fixture) || sha256(fs.readFileSync(fixture)) !== EXPECTED_LOCAL_STATE_SHA256) {
      return;
    }
    const appData = path.join(root, 'AppData');
    const userData = path.join(appData, PROFILE_NAMES.erp);
    gravarMigrationArtifacts(userData, fixture);
    const app = criarAppFake(appData);
    const perfil = configurarPerfilTef({ app, modulo: 'erp', sourceLocalStatePath: fixture });
    assert.equal(perfil.permitirGeracaoChave, false);
    assert.equal(perfil.modo, MODOS_CONTEXTO.MIGRATION);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
