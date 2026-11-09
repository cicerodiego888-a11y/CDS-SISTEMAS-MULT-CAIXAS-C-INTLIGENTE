'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATABASE_FILENAME = 'mercadao.db';
const KEY_FILENAME = '.tef-signing-key.v1';
const EVENT_TYPES = Object.freeze([
  'TEF_RECONCILIACAO_LIBERADA',
  'TEF_RECONCILIACAO_COMMIT_CONFIRMADO'
]);
const STORE_FIELDS = Object.freeze(['algoritmo', 'ciphertext', 'versao']);

function criarErro(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function falharChaveInvalida() {
  return criarErro(
    'TEF_CHAVE_INVALIDA',
    'A chave criptográfica TEF está ausente ou não atende ao contrato de assinatura.'
  );
}

function validarChave(chave, evidenceModule) {
  if (typeof chave !== 'string' || !/^[a-f0-9]{64}$/i.test(chave)) {
    throw falharChaveInvalida();
  }

  const anterior = process.env.TEF_ENCRYPTION_KEY;
  process.env.TEF_ENCRYPTION_KEY = chave;
  try {
    return evidenceModule.obterChavePublica();
  } catch (_) {
    throw falharChaveInvalida();
  } finally {
    if (anterior === undefined) delete process.env.TEF_ENCRYPTION_KEY;
    else process.env.TEF_ENCRYPTION_KEY = anterior;
  }
}

function mesmoSegredo(primeiro, segundo) {
  if (!/^[a-f0-9]{64}$/i.test(String(primeiro || ''))
      || !/^[a-f0-9]{64}$/i.test(String(segundo || ''))) {
    return false;
  }
  return Buffer.from(primeiro, 'hex').equals(Buffer.from(segundo, 'hex'));
}

function validarFormatoStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return false;
  const fields = Object.keys(store).sort();
  if (fields.length !== STORE_FIELDS.length
      || !STORE_FIELDS.every((field, index) => field === fields[index])) {
    return false;
  }
  if (store.versao !== 1 || store.algoritmo !== 'electron-safeStorage'
      || typeof store.ciphertext !== 'string' || !store.ciphertext.length) {
    return false;
  }
  const bytes = Buffer.from(store.ciphertext, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === store.ciphertext;
}

function lerSegredoArmazenado(caminho, safeStorage, fsApi, evidenceModule) {
  let conteudo;
  try {
    conteudo = fsApi.readFileSync(caminho, 'utf8');
  } catch (_) {
    throw criarErro(
      'TEF_CHAVE_LEITURA_FALHOU',
      'Não foi possível ler o armazenamento protegido da chave TEF.'
    );
  }

  let store;
  try {
    store = JSON.parse(conteudo);
  } catch (_) {
    throw criarErro(
      'TEF_CHAVE_ARMAZENADA_CORROMPIDA',
      'O armazenamento protegido da chave TEF está corrompido.'
    );
  }
  if (!validarFormatoStore(store)) {
    throw criarErro(
      'TEF_CHAVE_ARMAZENADA_CORROMPIDA',
      'O armazenamento protegido da chave TEF está corrompido.'
    );
  }

  let segredo;
  try {
    segredo = safeStorage.decryptString(Buffer.from(store.ciphertext, 'base64'));
  } catch (error) {
    const falha = criarErro(
      'TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU',
      'Não foi possível recuperar a chave TEF com a proteção do sistema operacional.'
    );
    falha.cause = error;
    throw falha;
  }
  validarChave(segredo, evidenceModule);
  return segredo;
}

function lerChaveTefPersistida({
  safeStorage,
  dbDir,
  env = process.env,
  fsApi = fs,
  evidenceModule = require('./tefReconciliationEvidence')
} = {}) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function'
      || typeof safeStorage.decryptString !== 'function'
      || !safeStorage.isEncryptionAvailable()) {
    throw criarErro(
      'TEF_CHAVE_ARMAZENAMENTO_INDISPONIVEL',
      'O armazenamento criptográfico protegido do sistema operacional está indisponível.'
    );
  }
  if (typeof dbDir !== 'string' || !dbDir.trim()) {
    throw criarErro(
      'TEF_CHAVE_DIRETORIO_INVALIDO',
      'O diretório de dados TEF não está configurado.'
    );
  }

  const caminhoStore = path.join(dbDir, KEY_FILENAME);
  let storeStats;
  try {
    storeStats = fsApi.statSync(caminhoStore);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw criarErro(
        'TEF_CHAVE_AUSENTE_SEM_FALLBACK',
        'A chave TEF original não está disponível; a inicialização sem substituição foi bloqueada.'
      );
    }
    throw criarErro(
      'TEF_CHAVE_LEITURA_FALHOU',
      'Não foi possível ler o armazenamento protegido da chave TEF.'
    );
  }
  if (!storeStats.isFile()) {
    throw criarErro(
      'TEF_CHAVE_ARMAZENADA_CORROMPIDA',
      'O armazenamento protegido da chave TEF está corrompido.'
    );
  }

  const segredoArmazenado = lerSegredoArmazenado(
    caminhoStore,
    safeStorage,
    fsApi,
    evidenceModule
  );
  const segredoAmbiente = env.TEF_ENCRYPTION_KEY;
  if (segredoAmbiente !== undefined && !mesmoSegredo(segredoAmbiente, segredoArmazenado)) {
    throw criarErro(
      'TEF_CHAVE_AMBIENTE_DIVERGENTE',
      'A chave TEF configurada diverge da chave persistida protegida.'
    );
  }
  return segredoArmazenado;
}

function criarStore(segredo, safeStorage) {
  let ciphertext;
  try {
    ciphertext = safeStorage.encryptString(segredo);
  } catch (_) {
    throw criarErro(
      'TEF_CHAVE_CRIPTOGRAFIA_FALHOU',
      'Não foi possível proteger a chave TEF com o sistema operacional.'
    );
  }
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
    throw criarErro(
      'TEF_CHAVE_CRIPTOGRAFIA_FALHOU',
      'Não foi possível proteger a chave TEF com o sistema operacional.'
    );
  }
  let segredoRecuperado;
  try {
    segredoRecuperado = safeStorage.decryptString(ciphertext);
  } catch (error) {
    const falha = criarErro(
      'TEF_CHAVE_VERIFICACAO_FALHOU',
      'A chave TEF recém-protegida não passou pela verificação de recuperação.'
    );
    falha.cause = error;
    throw falha;
  }
  if (!mesmoSegredo(segredo, segredoRecuperado)) {
    throw criarErro(
      'TEF_CHAVE_VERIFICACAO_FALHOU',
      'A chave TEF recém-protegida não corresponde à chave original.'
    );
  }
  return {
    versao: 1,
    algoritmo: 'electron-safeStorage',
    ciphertext: ciphertext.toString('base64')
  };
}

function gravarStoreExclusivo(caminho, store, fsApi) {
  const temporario = path.join(
    path.dirname(caminho),
    `${KEY_FILENAME}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let descriptor;
  let erroPersistencia;
  try {
    fsApi.mkdirSync(path.dirname(caminho), { recursive: true, mode: 0o700 });
    descriptor = fsApi.openSync(temporario, 'wx', 0o600);
    fsApi.writeFileSync(descriptor, JSON.stringify(store), 'utf8');
    fsApi.fsyncSync(descriptor);
    fsApi.closeSync(descriptor);
    descriptor = undefined;
    fsApi.linkSync(temporario, caminho);
  } catch (error) {
    erroPersistencia = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fsApi.closeSync(descriptor);
      } catch (_) {
        erroPersistencia = erroPersistencia || _;
      }
    }
    try {
      fsApi.unlinkSync(temporario);
    } catch (erroRemocao) {
      if (erroRemocao.code !== 'ENOENT') erroPersistencia = erroPersistencia || erroRemocao;
    }
  }
  if (erroPersistencia) {
    if (erroPersistencia.code === 'EEXIST') throw erroPersistencia;
    throw criarErro(
      'TEF_CHAVE_PERSISTENCIA_FALHOU',
      'Não foi possível persistir com segurança a chave TEF.'
    );
  }
}

async function lerSegredoArmazenadoComRetentativa(caminho, safeStorage, fsApi, evidenceModule) {
  let ultimoErro;
  for (let tentativa = 0; tentativa < 10; tentativa += 1) {
    try {
      return lerSegredoArmazenado(caminho, safeStorage, fsApi, evidenceModule);
    } catch (error) {
      if (error.code !== 'TEF_CHAVE_ARMAZENADA_CORROMPIDA') throw error;
      ultimoErro = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw ultimoErro;
}

function consultarEvidenciasPersistidas(caminhoBanco, {
  fsApi = fs,
  sqlite3: sqlite3Injetado
} = {}) {
  try {
    if (!fsApi.statSync(caminhoBanco).isFile()) {
      return Promise.reject(criarErro(
        'TEF_EVIDENCIA_LEITURA_FALHOU',
        'Não foi possível verificar as evidências TEF persistidas.'
      ));
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return Promise.resolve([]);
    return Promise.reject(criarErro(
      'TEF_EVIDENCIA_LEITURA_FALHOU',
      'Não foi possível verificar as evidências TEF persistidas.'
    ));
  }

  let sqlite3;
  try {
    sqlite3 = sqlite3Injetado || require('sqlite3').verbose();
  } catch (_) {
    return Promise.reject(criarErro(
      'TEF_EVIDENCIA_LEITURA_FALHOU',
      'Não foi possível verificar as evidências TEF persistidas.'
    ));
  }

  return new Promise((resolve, reject) => {
    let database;
    let concluido = false;

    const fechar = (erro, rows = []) => {
      if (concluido) return;
      concluido = true;
      if (!database) {
        if (erro) reject(erro);
        else resolve(rows);
        return;
      }
      database.close((erroFechamento) => {
        if (erro || erroFechamento) {
          reject(criarErro(
            'TEF_EVIDENCIA_LEITURA_FALHOU',
            'Não foi possível verificar as evidências TEF persistidas.'
          ));
          return;
        }
        resolve(rows);
      });
    };

    try {
      database = new sqlite3.Database(
        caminhoBanco,
        sqlite3.OPEN_READONLY,
        (erroAbertura) => {
          if (erroAbertura) {
            fechar(erroAbertura);
            return;
          }
          database.all(`
            SELECT transacao_id, tipo, payload
            FROM tef_logs
            WHERE tipo IN ('TEF_RECONCILIACAO_LIBERADA', 'TEF_RECONCILIACAO_COMMIT_CONFIRMADO')
            ORDER BY id ASC
          `, [], (erroConsulta, rows) => {
            if (erroConsulta && /no such table:\s*tef_logs/i.test(erroConsulta.message || '')) {
              fechar(null, []);
              return;
            }
            if (erroConsulta) {
              fechar(erroConsulta);
              return;
            }
            fechar(null, rows || []);
          });
        }
      );
    } catch (erroAbertura) {
      fechar(erroAbertura);
    }
  });
}

function evidenciasCorrespondemAChave(rows, publicKey, evidenceModule) {
  return rows.length > 0 && rows.every((row) => {
    let evidencia;
    try {
      evidencia = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    } catch (_) {
      return false;
    }
    const claims = evidenceModule.validarEvidencia(evidencia, row.tipo, publicKey);
    const transacaoId = String(row.transacao_id ?? '');
    return Boolean(
      claims
      && EVENT_TYPES.includes(row.tipo)
      && transacaoId.trim()
      && claims.transacao_id === transacaoId
      && claims.transactionId === transacaoId
      && typeof claims.operation_id === 'string' && claims.operation_id.trim()
      && typeof claims.idempotency_key === 'string' && claims.idempotency_key.trim()
      && typeof claims.fingerprint === 'string' && claims.fingerprint.trim()
    );
  });
}

async function aguardarStoreConcorrente(caminho, safeStorage, fsApi, evidenceModule) {
  let ultimoErro;
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    try {
      return lerSegredoArmazenado(caminho, safeStorage, fsApi, evidenceModule);
    } catch (error) {
      if (error.code !== 'TEF_CHAVE_LEITURA_FALHOU'
          && error.code !== 'TEF_CHAVE_ARMAZENADA_CORROMPIDA'
          && error.code !== 'TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU') {
        throw error;
      }
      ultimoErro = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (ultimoErro && ultimoErro.code !== 'TEF_CHAVE_LEITURA_FALHOU') throw ultimoErro;
  throw criarErro(
    'TEF_CHAVE_PERSISTENCIA_CONCORRENTE',
    'A inicialização concorrente da chave TEF não foi concluída com segurança.'
  );
}

async function provisionarChaveTef({
  safeStorage,
  dbDir,
  permitirGeracaoChave = true,
  env = process.env,
  fsApi = fs,
  cryptoApi = crypto,
  evidenceModule = require('./tefReconciliationEvidence'),
  sqlite3
} = {}) {
  try {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function'
        || typeof safeStorage.encryptString !== 'function'
        || typeof safeStorage.decryptString !== 'function'
        || !safeStorage.isEncryptionAvailable()) {
      throw criarErro(
        'TEF_CHAVE_ARMAZENAMENTO_INDISPONIVEL',
        'O armazenamento criptográfico protegido do sistema operacional está indisponível.'
      );
    }
    if (typeof dbDir !== 'string' || !dbDir.trim()) {
      throw criarErro(
        'TEF_CHAVE_DIRETORIO_INVALIDO',
        'O diretório de dados TEF não está configurado.'
      );
    }

    const caminhoStore = path.join(dbDir, KEY_FILENAME);
    const caminhoBanco = path.join(dbDir, DATABASE_FILENAME);
    const segredoAmbiente = env.TEF_ENCRYPTION_KEY;

    let storeExiste = false;
    try {
      const storeStats = fsApi.statSync(caminhoStore);
      if (!storeStats.isFile()) {
        throw criarErro(
          'TEF_CHAVE_ARMAZENADA_CORROMPIDA',
          'O armazenamento protegido da chave TEF está corrompido.'
        );
      }
      storeExiste = true;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }

    if (!storeExiste && !permitirGeracaoChave) {
      throw criarErro(
        'TEF_CHAVE_AUSENTE_SEM_FALLBACK',
        'A chave TEF original não está disponível; a inicialização sem substituição foi bloqueada.'
      );
    }

    if (storeExiste) {
      const segredoArmazenado = await lerSegredoArmazenadoComRetentativa(
        caminhoStore,
        safeStorage,
        fsApi,
        evidenceModule
      );
      if (segredoAmbiente !== undefined
          && (!validarChave(segredoAmbiente, evidenceModule)
            || !mesmoSegredo(segredoAmbiente, segredoArmazenado))) {
        throw criarErro(
          'TEF_CHAVE_AMBIENTE_DIVERGENTE',
          'A chave TEF configurada diverge da chave persistida protegida.'
        );
      }
      env.TEF_ENCRYPTION_KEY = segredoArmazenado;
      return { sucesso: true, origem: 'armazenamento-protegido' };
    }

    const evidencias = await consultarEvidenciasPersistidas(caminhoBanco, {
      fsApi,
      sqlite3
    });

    let segredo;
    let publicKey;
    let origem;
    if (segredoAmbiente !== undefined) {
      segredo = segredoAmbiente;
      publicKey = validarChave(segredo, evidenceModule);
      if (evidencias.length && !evidenciasCorrespondemAChave(evidencias, publicKey, evidenceModule)) {
        throw criarErro(
          'TEF_CHAVE_AUSENTE_COM_EVIDENCIA',
          'Há evidências TEF persistidas que não podem ser vinculadas à chave disponível.'
        );
      }
      origem = 'ambiente-validado';
    } else {
      if (evidencias.length) {
        throw criarErro(
          'TEF_CHAVE_AUSENTE_COM_EVIDENCIA',
          'Há evidências TEF persistidas, mas a chave criptográfica original não está disponível.'
        );
      }
      segredo = cryptoApi.randomBytes(32).toString('hex');
      publicKey = validarChave(segredo, evidenceModule);
      origem = 'gerada';
    }

    const store = criarStore(segredo, safeStorage);
    let segredoPersistido = segredo;
    let storeCriado = false;
    try {
      gravarStoreExclusivo(caminhoStore, store, fsApi);
      storeCriado = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      segredoPersistido = await aguardarStoreConcorrente(
        caminhoStore,
        safeStorage,
        fsApi,
        evidenceModule
      );
      if (origem === 'ambiente-validado'
          && !mesmoSegredo(segredo, segredoPersistido)) {
        throw criarErro(
          'TEF_CHAVE_AMBIENTE_DIVERGENTE',
          'A chave TEF configurada diverge da chave persistida protegida.'
        );
      }
    }

    if (storeCriado) {
      segredoPersistido = lerSegredoArmazenado(
        caminhoStore,
        safeStorage,
        fsApi,
        evidenceModule
      );
      if (!mesmoSegredo(segredo, segredoPersistido)) {
        throw criarErro(
          'TEF_CHAVE_PERSISTENCIA_VERIFICACAO_FALHOU',
          'A chave TEF gravada não corresponde à chave validada antes da persistência.'
        );
      }
    }

    if (origem === 'ambiente-validado') {
      validarChave(segredoPersistido, evidenceModule);
    } else if (segredoPersistido !== segredo) {
      validarChave(segredoPersistido, evidenceModule);
      origem = 'armazenamento-concorrente';
    }
    env.TEF_ENCRYPTION_KEY = segredoPersistido;
    return { sucesso: true, origem };
  } catch (error) {
    delete env.TEF_ENCRYPTION_KEY;
    if (error && typeof error.code === 'string' && error.code.startsWith('TEF_')) {
      throw error;
    }
    throw criarErro(
      'TEF_CHAVE_PROVISIONAMENTO_FALHOU',
      'Não foi possível inicializar a chave criptográfica TEF com segurança.'
    );
  }
}

module.exports = {
  KEY_FILENAME,
  lerChaveTefPersistida,
  consultarEvidenciasPersistidas,
  provisionarChaveTef
};
