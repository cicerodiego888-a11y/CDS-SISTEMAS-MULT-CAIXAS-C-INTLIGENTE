'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP_NAME = 'cds-sistemas';
const EXPECTED_LOCAL_STATE_SHA256 = '26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040';
const MARKER_FILENAME = '.cds-tef-crypto-context.json';
const MODOS_CONTEXTO = Object.freeze({
  MIGRATION: 'MIGRATION',
  FIRST_INSTALL: 'FIRST_INSTALL'
});
const PROFILE_NAMES = Object.freeze({
  erp: 'cds-sistemas-erp',
  pdv: 'cds-sistemas-pdv'
});

function criarErro(code, message) {
  const error = new Error(message);
  error.code = code;
  error.etapa = 'contexto-criptografico';
  return error;
}

function sha256File(filePath, fsApi = fs) {
  return crypto.createHash('sha256').update(fsApi.readFileSync(filePath)).digest('hex').toUpperCase();
}

function compararCaminhos(first, second) {
  return path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase();
}

function criarArquivoAtomicoSemSobrescrever(filePath, contents, fsApi = fs) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let descriptor;
  let operationError;
  let criado = false;

  try {
    descriptor = fsApi.openSync(temporaryPath, 'wx', 0o600);
    fsApi.writeFileSync(descriptor, contents);
    fsApi.fsyncSync(descriptor);
    fsApi.closeSync(descriptor);
    descriptor = undefined;
    fsApi.linkSync(temporaryPath, filePath);
    criado = true;
  } catch (error) {
    if (!error || error.code !== 'EEXIST') operationError = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fsApi.closeSync(descriptor);
      } catch (error) {
        operationError = operationError || error;
      }
    }
    try {
      fsApi.unlinkSync(temporaryPath);
    } catch (error) {
      if (error.code !== 'ENOENT') operationError = operationError || error;
    }
  }

  if (operationError) throw operationError;
  return criado;
}

function lerMarker(markerPath, fsApi = fs) {
  try {
    return JSON.parse(fsApi.readFileSync(markerPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw criarErro(
      'TEF_CONTEXTO_MARKER_INVALIDO',
      'O registro do contexto criptográfico do perfil está ausente ou corrompido.'
    );
  }
}

function normalizarModoMarker(marker) {
  if (!marker) return null;
  if (marker.modo === MODOS_CONTEXTO.FIRST_INSTALL) return MODOS_CONTEXTO.FIRST_INSTALL;
  // Marcadores legados MRT-50.38 (sem campo modo) = migração homologada.
  return MODOS_CONTEXTO.MIGRATION;
}

function validarMarker(marker, { modulo, userDataPath, localStateSha256 = null }) {
  if (!marker
      || marker.versao !== 1
      || marker.appName !== APP_NAME
      || marker.modulo !== modulo
      || typeof marker.localStateOrigemSha256 !== 'string'
      || !compararCaminhos(marker.userDataPath, userDataPath)) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O perfil já possui um contexto criptográfico diferente ou não reconhecido.'
    );
  }

  const modo = normalizarModoMarker(marker);
  if (modo === MODOS_CONTEXTO.MIGRATION) {
    if (marker.localStateOrigemSha256 !== EXPECTED_LOCAL_STATE_SHA256) {
      throw criarErro(
        'TEF_CONTEXTO_PERFIL_DIVERGENTE',
        'O perfil já possui um contexto criptográfico diferente ou não reconhecido.'
      );
    }
    if (localStateSha256 != null && localStateSha256 !== EXPECTED_LOCAL_STATE_SHA256) {
      throw criarErro(
        'TEF_CONTEXTO_PERFIL_DIVERGENTE',
        'O Local State existente não corresponde ao contexto criptográfico validado.'
      );
    }
    return modo;
  }

  if (modo === MODOS_CONTEXTO.FIRST_INSTALL) {
    if (localStateSha256 != null && marker.localStateOrigemSha256 !== localStateSha256) {
      throw criarErro(
        'TEF_CONTEXTO_PERFIL_DIVERGENTE',
        'O Local State FIRST_INSTALL não corresponde ao marcador deste perfil.'
      );
    }
    return modo;
  }

  throw criarErro(
    'TEF_CONTEXTO_PERFIL_DIVERGENTE',
    'O perfil já possui um contexto criptográfico diferente ou não reconhecido.'
  );
}

/**
 * Distingue migração (Local State preservado) de instalação realmente nova.
 * Não provisiona chave; apenas classifica o roteamento do contexto.
 */
function classificarRoteamentoContexto({
  marker,
  localStatePath,
  sourceLocalStatePath,
  userDataPath,
  fsApi = fs
} = {}) {
  if (marker) {
    const modo = normalizarModoMarker(marker);
    return {
      roteamento: modo === MODOS_CONTEXTO.FIRST_INSTALL
        ? 'FIRST_INSTALL_EXISTENTE'
        : 'MIGRATION_EXISTENTE',
      modo
    };
  }

  const localStateExiste = Boolean(localStatePath && fsApi.existsSync(localStatePath));
  let entradas = [];
  try {
    entradas = fsApi.readdirSync(userDataPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }

  if (!localStateExiste && entradas.length > 0) {
    return { roteamento: 'PERFIL_NAO_VAZIO', modo: null };
  }

  const sourceInformada = typeof sourceLocalStatePath === 'string'
    && sourceLocalStatePath.trim().length > 0;

  if (!localStateExiste && entradas.length === 0) {
    if (sourceInformada) {
      return { roteamento: 'MIGRATION_PROVISION', modo: MODOS_CONTEXTO.MIGRATION };
    }
    return { roteamento: 'FIRST_INSTALL', modo: MODOS_CONTEXTO.FIRST_INSTALL };
  }

  // Local State presente sem marcador: só migração pode concluir via origem preservada.
  if (localStateExiste && sourceInformada) {
    return { roteamento: 'MIGRATION_PROVISION', modo: MODOS_CONTEXTO.MIGRATION };
  }
  if (localStateExiste && !sourceInformada) {
    // Instalação nova interrompida após Electron criar Local State — finalizar marcador.
    return { roteamento: 'FIRST_INSTALL_PENDING_MARKER', modo: MODOS_CONTEXTO.FIRST_INSTALL };
  }

  return { roteamento: 'INDEFINIDO', modo: null };
}

function validarLocalState(filePath, fsApi = fs) {
  if (!fsApi.existsSync(filePath)) {
    throw criarErro(
      'TEF_CONTEXTO_LOCAL_STATE_AUSENTE',
      'O perfil não contém o Local State do contexto criptográfico provisionado.'
    );
  }
  try {
    if (!fsApi.statSync(filePath).isFile()) {
      throw new Error('NOT_A_FILE');
    }
    return sha256File(filePath, fsApi);
  } catch (_) {
    throw criarErro(
      'TEF_CONTEXTO_LOCAL_STATE_INVALIDO',
      'Não foi possível validar o Local State do perfil criptográfico.'
    );
  }
}

function instalarLocalState(sourcePath, targetPath, fsApi = fs) {
  if (!sourcePath || !fsApi.existsSync(sourcePath)) {
    throw criarErro(
      'TEF_CONTEXTO_ORIGEM_AUSENTE',
      'A cópia preservada do Local State de origem não está disponível.'
    );
  }

  let sourceHash;
  try {
    sourceHash = sha256File(sourcePath, fsApi);
  } catch (_) {
    throw criarErro(
      'TEF_CONTEXTO_ORIGEM_LEITURA_FALHOU',
      'Não foi possível ler a cópia preservada do Local State.'
    );
  }
  if (sourceHash !== EXPECTED_LOCAL_STATE_SHA256) {
    throw criarErro(
      'TEF_CONTEXTO_ORIGEM_HASH_DIVERGENTE',
      'O Local State de origem não corresponde ao contexto MRT-50.37 validado.'
    );
  }

  if (fsApi.existsSync(targetPath)) {
    const targetHash = validarLocalState(targetPath, fsApi);
    if (targetHash !== EXPECTED_LOCAL_STATE_SHA256) {
      throw criarErro(
        'TEF_CONTEXTO_DESTINO_JA_INICIALIZADO',
        'O perfil de destino já possui outro Local State; nenhuma substituição foi feita.'
      );
    }
    return { criado: false, sha256: targetHash };
  }

  let sourceContents;
  try {
    sourceContents = fsApi.readFileSync(sourcePath);
  } catch (_) {
    throw criarErro(
      'TEF_CONTEXTO_ORIGEM_LEITURA_FALHOU',
      'Não foi possível ler a cópia preservada do Local State.'
    );
  }

  try {
    criarArquivoAtomicoSemSobrescrever(targetPath, sourceContents, fsApi);
  } catch (_) {
    throw criarErro(
      'TEF_CONTEXTO_INSTALACAO_FALHOU',
      'Não foi possível instalar atomicamente o Local State no perfil.'
    );
  }

  const targetHash = validarLocalState(targetPath, fsApi);
  if (targetHash !== EXPECTED_LOCAL_STATE_SHA256) {
    throw criarErro(
      'TEF_CONTEXTO_DESTINO_HASH_DIVERGENTE',
      'O Local State instalado não corresponde ao hash de origem validado.'
    );
  }
  return { criado: true, sha256: targetHash };
}

function gravarMarker(markerPath, marker, fsApi = fs) {
  const contents = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  try {
    criarArquivoAtomicoSemSobrescrever(markerPath, contents, fsApi);
  } catch (_) {
    throw criarErro(
      'TEF_CONTEXTO_MARKER_PERSISTENCIA_FALHOU',
      'Não foi possível registrar atomicamente o contexto criptográfico do perfil.'
    );
  }
  validarMarker(lerMarker(markerPath, fsApi), marker);
}

/** Seleciona apenas o caminho em memória; chamar antes de app.whenReady(). */
function selecionarPerfilTefExistente({ app, modulo } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_NAMES, modulo)) {
    throw criarErro('TEF_MODULO_INVALIDO', 'O módulo Electron deve ser explicitamente erp ou pdv.');
  }
  if (!app || typeof app.setName !== 'function' || typeof app.setPath !== 'function'
      || typeof app.getPath !== 'function' || typeof app.getName !== 'function') {
    throw criarErro('TEF_ELECTRON_APP_INVALIDO', 'A instância Electron não permite validar o perfil.');
  }

  try {
    const pronto = typeof app.isReady === 'function' && app.isReady();
    if (app.getName() !== APP_NAME) {
      if (pronto) {
        throw criarErro(
          'TEF_CONTEXTO_ELECTRON_JA_PRONTO',
          'O nome da aplicação precisa ser selecionado antes do Electron ficar pronto.'
        );
      }
      app.setName(APP_NAME);
    }

    const userDataPath = path.join(app.getPath('appData'), PROFILE_NAMES[modulo]);
    if (!compararCaminhos(app.getPath('userData'), userDataPath)) {
      if (pronto) {
        throw criarErro(
          'TEF_CONTEXTO_ELECTRON_JA_PRONTO',
          'O perfil TEF precisa ser selecionado antes do Electron ficar pronto.'
        );
      }
      app.setPath('userData', userDataPath);
    }
    if (app.getName() !== APP_NAME || !compararCaminhos(app.getPath('userData'), userDataPath)) {
      throw new Error('ELECTRON_PROFILE_SELECTION_MISMATCH');
    }
    return { appName: APP_NAME, modulo, userDataPath };
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('TEF_')) throw error;
    const failure = criarErro(
      'TEF_CONTEXTO_PERFIL_SELECAO_FALHOU',
      'Não foi possível selecionar o perfil criptográfico existente.'
    );
    failure.cause = error;
    throw failure;
  }
}

function validarPerfilTefExistente({ app, modulo, fsApi = fs } = {}) {
  try {
    const { userDataPath } = selecionarPerfilTefExistente({ app, modulo });
    const markerPath = path.join(userDataPath, MARKER_FILENAME);
    const marker = lerMarker(markerPath, fsApi);
    // Marcador ausente/divergente falha antes de tocar o Local State (fail-closed).
    validarMarker(marker, { modulo, userDataPath });
    const localStateSha256 = validarLocalState(path.join(userDataPath, 'Local State'), fsApi);
    const modo = validarMarker(marker, { modulo, userDataPath, localStateSha256 });

    return {
      appName: APP_NAME,
      modulo,
      userDataPath,
      markerPath,
      localStateSha256,
      modo
    };
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('TEF_')) throw error;
    const failure = criarErro(
      'TEF_CONTEXTO_PERFIL_VALIDACAO_FALHOU',
      'Não foi possível validar o perfil criptográfico existente.'
    );
    failure.cause = error;
    throw failure;
  }
}

function validarPerfilTefOriginalSomenteLeitura({
  appName,
  modulo,
  appDataPath,
  userDataPath,
  fsApi = fs
} = {}) {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_NAMES, modulo)) {
    throw criarErro('TEF_MODULO_INVALIDO', 'O módulo Electron deve ser explicitamente erp ou pdv.');
  }
  if (appName !== APP_NAME
      || typeof appDataPath !== 'string'
      || typeof userDataPath !== 'string'
      || !compararCaminhos(userDataPath, path.join(appDataPath, PROFILE_NAMES[modulo]))) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O caminho de origem não corresponde ao perfil esperado do módulo.'
    );
  }

  const markerPath = path.join(userDataPath, MARKER_FILENAME);
  const marker = lerMarker(markerPath, fsApi);
  const localStateSha256 = validarLocalState(path.join(userDataPath, 'Local State'), fsApi);
  const modo = validarMarker(marker, { modulo, userDataPath, localStateSha256 });
  if (modo !== MODOS_CONTEXTO.MIGRATION) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'Snapshot isolado exige contexto de migração homologado.'
    );
  }

  return Object.freeze({
    appName: APP_NAME,
    modulo,
    appDataPath: path.resolve(appDataPath),
    userDataPath: path.resolve(userDataPath),
    markerPath,
    localStateSha256,
    modo
  });
}

function validarSnapshotPerfilTefIsolado({
  app,
  modulo,
  perfilOriginal,
  snapshotUserDataPath,
  fsApi = fs
} = {}) {
  if (!app || typeof app.getName !== 'function' || typeof app.getPath !== 'function') {
    throw criarErro('TEF_ELECTRON_APP_INVALIDO', 'A instância Electron não permite validar o snapshot.');
  }
  if (!perfilOriginal || perfilOriginal.modulo !== modulo) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O snapshot não está associado ao perfil original selecionado.'
    );
  }

  const perfilRevalidado = validarPerfilTefOriginalSomenteLeitura({
    appName: app.getName(),
    modulo,
    appDataPath: perfilOriginal.appDataPath,
    userDataPath: perfilOriginal.userDataPath,
    fsApi
  });
  if (perfilRevalidado.localStateSha256 !== perfilOriginal.localStateSha256
      || typeof snapshotUserDataPath !== 'string'
      || !compararCaminhos(app.getPath('userData'), snapshotUserDataPath)
      || compararCaminhos(snapshotUserDataPath, perfilOriginal.userDataPath)) {
    throw criarErro(
      'TEF_CONTEXTO_SNAPSHOT_PATH_DIVERGENTE',
      'O userData isolado não corresponde ao snapshot separado do perfil original.'
    );
  }

  const snapshotLocalStateSha256 = validarLocalState(
    path.join(snapshotUserDataPath, 'Local State'),
    fsApi
  );
  if (snapshotLocalStateSha256 !== perfilOriginal.localStateSha256) {
    throw criarErro(
      'TEF_CONTEXTO_SNAPSHOT_HASH_DIVERGENTE',
      'O Local State isolado não corresponde ao perfil ERP original validado.'
    );
  }

  return Object.freeze({
    appName: APP_NAME,
    modulo,
    originalUserDataPath: perfilOriginal.userDataPath,
    snapshotUserDataPath: path.resolve(snapshotUserDataPath),
    markerPath: perfilOriginal.markerPath,
    originalLocalStateSha256: perfilOriginal.localStateSha256,
    snapshotLocalStateSha256
  });
}

function configurarPerfilTef({ app, modulo, sourceLocalStatePath, fsApi = fs } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_NAMES, modulo)) {
    throw criarErro('TEF_MODULO_INVALIDO', 'O módulo Electron deve ser explicitamente erp ou pdv.');
  }
  if (!app || typeof app.setName !== 'function' || typeof app.setPath !== 'function'
      || typeof app.getPath !== 'function') {
    throw criarErro('TEF_ELECTRON_APP_INVALIDO', 'A instância Electron não permite configurar o perfil.');
  }

  try {
    app.setName(APP_NAME);
    if (app.getName() !== APP_NAME) {
      throw new Error('APP_NAME_MISMATCH');
    }
    const userDataPath = path.join(app.getPath('appData'), PROFILE_NAMES[modulo]);
    app.setPath('userData', userDataPath);
    if (!compararCaminhos(app.getPath('userData'), userDataPath)) {
      throw new Error('USER_DATA_PATH_MISMATCH');
    }

    fsApi.mkdirSync(userDataPath, { recursive: true });
    const localStatePath = path.join(userDataPath, 'Local State');
    const markerPath = path.join(userDataPath, MARKER_FILENAME);
    const marker = lerMarker(markerPath, fsApi);
    const classificacao = classificarRoteamentoContexto({
      marker,
      localStatePath,
      sourceLocalStatePath,
      userDataPath,
      fsApi
    });
    let instalacao = { criado: false, sha256: null };
    let modo = classificacao.modo;

    if (classificacao.roteamento === 'PERFIL_NAO_VAZIO') {
      throw criarErro(
        'TEF_CONTEXTO_PERFIL_NAO_VAZIO',
        'O perfil de destino contém dados sem registro de contexto; nenhuma alteração foi feita.'
      );
    }

    if (classificacao.roteamento === 'MIGRATION_EXISTENTE'
        || classificacao.roteamento === 'FIRST_INSTALL_EXISTENTE') {
      instalacao.sha256 = validarLocalState(localStatePath, fsApi);
      modo = validarMarker(marker, {
        modulo,
        userDataPath,
        localStateSha256: instalacao.sha256
      });
      return {
        appName: APP_NAME,
        modulo,
        userDataPath,
        markerPath,
        localStateSha256: instalacao.sha256,
        localStateInstalado: false,
        modo,
        roteamento: classificacao.roteamento,
        firstInstallPendente: false,
        permitirGeracaoChave: false
      };
    }

    if (classificacao.roteamento === 'FIRST_INSTALL'
        || classificacao.roteamento === 'FIRST_INSTALL_PENDING_MARKER') {
      // Não copia Local State de outra instalação. Electron cria o contexto no userData
      // definitivo; o marcador e a chave usam o bootstrap oficial pós-whenReady.
      if (classificacao.roteamento === 'FIRST_INSTALL_PENDING_MARKER') {
        instalacao.sha256 = validarLocalState(localStatePath, fsApi);
      }
      return {
        appName: APP_NAME,
        modulo,
        userDataPath,
        markerPath,
        localStateSha256: instalacao.sha256,
        localStateInstalado: false,
        modo: MODOS_CONTEXTO.FIRST_INSTALL,
        roteamento: classificacao.roteamento,
        firstInstallPendente: true,
        permitirGeracaoChave: true
      };
    }

    if (classificacao.roteamento !== 'MIGRATION_PROVISION') {
      throw criarErro(
        'TEF_CONTEXTO_PERFIL_CONFIGURACAO_FALHOU',
        'Não foi possível classificar o roteamento do contexto criptográfico.'
      );
    }

    instalacao = instalarLocalState(sourceLocalStatePath, localStatePath, fsApi);
    const novoMarker = {
      versao: 1,
      appName: APP_NAME,
      modulo,
      modo: MODOS_CONTEXTO.MIGRATION,
      userDataPath,
      localStateOrigemSha256: EXPECTED_LOCAL_STATE_SHA256,
      provisionadoEm: new Date().toISOString()
    };
    gravarMarker(markerPath, novoMarker, fsApi);
    modo = MODOS_CONTEXTO.MIGRATION;

    return {
      appName: APP_NAME,
      modulo,
      userDataPath,
      markerPath,
      localStateSha256: instalacao.sha256,
      localStateInstalado: instalacao.criado,
      modo,
      roteamento: classificacao.roteamento,
      firstInstallPendente: false,
      permitirGeracaoChave: false
    };
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('TEF_')) throw error;
    const failure = criarErro(
      'TEF_CONTEXTO_PERFIL_CONFIGURACAO_FALHOU',
      'Não foi possível configurar o perfil criptográfico do módulo.'
    );
    failure.cause = error;
    throw failure;
  }
}

/**
 * Conclui FIRST_INSTALL no userData definitivo após o Electron materializar o Local State.
 * Não sobrescreve marcador/Local State existentes de outra instalação.
 */
function finalizarContextoFirstInstall({ app, modulo, fsApi = fs } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_NAMES, modulo)) {
    throw criarErro('TEF_MODULO_INVALIDO', 'O módulo Electron deve ser explicitamente erp ou pdv.');
  }
  if (!app || typeof app.getPath !== 'function' || typeof app.getName !== 'function') {
    throw criarErro('TEF_ELECTRON_APP_INVALIDO', 'A instância Electron não permite finalizar o contexto.');
  }
  if (app.getName() !== APP_NAME) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O nome da aplicação não corresponde ao contexto TEF esperado.'
    );
  }

  const userDataPath = path.join(app.getPath('appData'), PROFILE_NAMES[modulo]);
  if (!compararCaminhos(app.getPath('userData'), userDataPath)) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O userData efetivo não é o diretório definitivo do módulo.'
    );
  }

  const localStatePath = path.join(userDataPath, 'Local State');
  const markerPath = path.join(userDataPath, MARKER_FILENAME);
  const markerExistente = lerMarker(markerPath, fsApi);
  const localStateSha256 = validarLocalState(localStatePath, fsApi);

  if (markerExistente) {
    const modo = validarMarker(markerExistente, {
      modulo,
      userDataPath,
      localStateSha256
    });
    return {
      appName: APP_NAME,
      modulo,
      userDataPath,
      markerPath,
      localStateSha256,
      modo,
      markerCriado: false,
      firstInstallPendente: false,
      permitirGeracaoChave: modo === MODOS_CONTEXTO.FIRST_INSTALL
    };
  }

  const novoMarker = {
    versao: 1,
    appName: APP_NAME,
    modulo,
    modo: MODOS_CONTEXTO.FIRST_INSTALL,
    userDataPath,
    localStateOrigemSha256: localStateSha256,
    provisionadoEm: new Date().toISOString()
  };
  gravarMarker(markerPath, novoMarker, fsApi);
  validarMarker(lerMarker(markerPath, fsApi), {
    modulo,
    userDataPath,
    localStateSha256
  });

  return {
    appName: APP_NAME,
    modulo,
    userDataPath,
    markerPath,
    localStateSha256,
    modo: MODOS_CONTEXTO.FIRST_INSTALL,
    markerCriado: true,
    firstInstallPendente: false,
    permitirGeracaoChave: true
  };
}

module.exports = {
  APP_NAME,
  EXPECTED_LOCAL_STATE_SHA256,
  MARKER_FILENAME,
  MODOS_CONTEXTO,
  PROFILE_NAMES,
  classificarRoteamentoContexto,
  selecionarPerfilTefExistente,
  validarPerfilTefExistente,
  validarPerfilTefOriginalSomenteLeitura,
  validarSnapshotPerfilTefIsolado,
  configurarPerfilTef,
  finalizarContextoFirstInstall
};
