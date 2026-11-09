'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP_NAME = 'cds-sistemas';
const EXPECTED_LOCAL_STATE_SHA256 = '26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040';
const MARKER_FILENAME = '.cds-tef-crypto-context.json';
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

function validarMarker(marker, { modulo, userDataPath }) {
  if (!marker
      || marker.versao !== 1
      || marker.appName !== APP_NAME
      || marker.modulo !== modulo
      || marker.localStateOrigemSha256 !== EXPECTED_LOCAL_STATE_SHA256
      || !compararCaminhos(marker.userDataPath, userDataPath)) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O perfil já possui um contexto criptográfico diferente ou não reconhecido.'
    );
  }
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
    validarMarker(marker, { modulo, userDataPath });
    const localStateSha256 = validarLocalState(path.join(userDataPath, 'Local State'), fsApi);
    if (localStateSha256 !== EXPECTED_LOCAL_STATE_SHA256) {
      throw criarErro(
        'TEF_CONTEXTO_PERFIL_DIVERGENTE',
        'O Local State existente não corresponde ao contexto criptográfico validado.'
      );
    }

    return {
      appName: APP_NAME,
      modulo,
      userDataPath,
      markerPath,
      localStateSha256
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
  validarMarker(marker, { modulo, userDataPath });
  const localStateSha256 = validarLocalState(path.join(userDataPath, 'Local State'), fsApi);
  if (localStateSha256 !== EXPECTED_LOCAL_STATE_SHA256) {
    throw criarErro(
      'TEF_CONTEXTO_PERFIL_DIVERGENTE',
      'O Local State original não corresponde ao contexto criptográfico validado.'
    );
  }

  return Object.freeze({
    appName: APP_NAME,
    modulo,
    appDataPath: path.resolve(appDataPath),
    userDataPath: path.resolve(userDataPath),
    markerPath,
    localStateSha256
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
    let instalacao = { criado: false, sha256: null };

    if (marker) {
      validarMarker(marker, { modulo, userDataPath });
      instalacao.sha256 = validarLocalState(localStatePath, fsApi);
    } else {
      if (!fsApi.existsSync(localStatePath) && fsApi.readdirSync(userDataPath).length > 0) {
        throw criarErro(
          'TEF_CONTEXTO_PERFIL_NAO_VAZIO',
          'O perfil de destino contém dados sem registro de contexto; nenhuma alteração foi feita.'
        );
      }
      instalacao = instalarLocalState(sourceLocalStatePath, localStatePath, fsApi);
      const novoMarker = {
        versao: 1,
        appName: APP_NAME,
        modulo,
        userDataPath,
        localStateOrigemSha256: EXPECTED_LOCAL_STATE_SHA256,
        provisionadoEm: new Date().toISOString()
      };
      gravarMarker(markerPath, novoMarker, fsApi);
    }

    return {
      appName: APP_NAME,
      modulo,
      userDataPath,
      markerPath,
      localStateSha256: instalacao.sha256,
      localStateInstalado: instalacao.criado
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

module.exports = {
  APP_NAME,
  EXPECTED_LOCAL_STATE_SHA256,
  MARKER_FILENAME,
  PROFILE_NAMES,
  selecionarPerfilTefExistente,
  validarPerfilTefExistente,
  validarPerfilTefOriginalSomenteLeitura,
  validarSnapshotPerfilTefIsolado,
  configurarPerfilTef
};
