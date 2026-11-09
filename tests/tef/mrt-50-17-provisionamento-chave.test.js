'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const evidence = require('../../backend/services/tef/tefReconciliationEvidence');
const {
  KEY_FILENAME,
  provisionarChaveTef
} = require('../../backend/services/tef/tefSigningKeyProvisioner');

function criarSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5));
    },
    decryptString(value) {
      return Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8');
    }
  };
}

function criarDiretorioTemporario() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt-50-17-'));
}

function limparDiretorioTemporario(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

async function executarComDiretorioTemporario(test) {
  const directory = criarDiretorioTemporario();
  try {
    await test(directory);
  } finally {
    limparDiretorioTemporario(directory);
  }
}

function criarBancoComEvidencias(dbDir, rows) {
  const dbPath = path.join(dbDir, 'mercadao.db');
  fs.mkdirSync(dbDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      database.serialize(() => {
        database.run(`
          CREATE TABLE tef_logs (
            id INTEGER PRIMARY KEY,
            transacao_id INTEGER,
            tipo TEXT,
            payload TEXT
          )
        `, (schemaError) => {
          if (schemaError) {
            database.close(() => reject(schemaError));
            return;
          }
          const statement = database.prepare(
            'INSERT INTO tef_logs (transacao_id, tipo, payload) VALUES (?, ?, ?)'
          );
          rows.forEach((row) => {
            statement.run(row.transacao_id, row.tipo, JSON.stringify(row.payload));
          });
          statement.finalize((insertError) => {
            database.close((closeError) => {
              if (insertError || closeError) reject(insertError || closeError);
              else resolve(dbPath);
            });
          });
        });
      });
    });
  });
}

function criarBancoSemTabelaTef(dbDir) {
  const dbPath = path.join(dbDir, 'mercadao.db');
  fs.mkdirSync(dbDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      database.run('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)', (schemaError) => {
        database.close((closeError) => {
          if (schemaError || closeError) reject(schemaError || closeError);
          else resolve(dbPath);
        });
      });
    });
  });
}

function tabelaTefExisteSomenteParaLeitura(dbPath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      database.get(
        "SELECT COUNT(*) AS quantidade FROM sqlite_master WHERE type = 'table' AND name = 'tef_logs'",
        (queryError, row) => {
          database.close((closeError) => {
            if (queryError || closeError) reject(queryError || closeError);
            else resolve(Number(row.quantidade) > 0);
          });
        }
      );
    });
  });
}

function criarEvidenciaAssinada(transactionId) {
  const identidade = {
    transactionId: String(transactionId),
    operation_id: `op-${transactionId}`,
    idempotency_key: `idem-${transactionId}`,
    fingerprint: `fp-${transactionId}`
  };
  const claims = evidence.criarClaimsEvidencia({
    eventType: evidence.EVENTO_LIBERACAO,
    identidade,
    financialState: 'CONFIRMED_SUCCESS',
    resultStatus: 'aprovado',
    usuario: 'mrt-50-17-isolated-test'
  });
  return evidence.assinarEvidencia(claims);
}

async function esperarCodigo(promise, expectedCode) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'A operação deveria falhar de forma explícita.');
  assert.strictEqual(error.code, expectedCode);
}

async function testePrimeiraInicializacaoEGeracao() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const env = {};
    const resultado = await provisionarChaveTef({
      safeStorage: criarSafeStorage(),
      dbDir,
      env
    });
    const caminho = path.join(dbDir, KEY_FILENAME);
    const conteudo = fs.readFileSync(caminho, 'utf8');

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.origem, 'gerada');
    assert.match(env.TEF_ENCRYPTION_KEY, /^[a-f0-9]{64}$/i);
    assert.notStrictEqual(env.TEF_ENCRYPTION_KEY, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    assert.strictEqual(conteudo.includes(env.TEF_ENCRYPTION_KEY), false);
  });
}

async function testeRecuperacaoNaReinicializacao() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const safeStorage = criarSafeStorage();
    const primeiraEnv = {};
    await provisionarChaveTef({ safeStorage, dbDir, env: primeiraEnv });

    const segundaEnv = {};
    const resultado = await provisionarChaveTef({ safeStorage, dbDir, env: segundaEnv });

    assert.strictEqual(resultado.origem, 'armazenamento-protegido');
    assert.strictEqual(segundaEnv.TEF_ENCRYPTION_KEY, primeiraEnv.TEF_ENCRYPTION_KEY);
  });
}

async function testeInicializacaoConcorrenteCompartilhaChave() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const safeStorage = criarSafeStorage();
    const primeiraEnv = {};
    const segundaEnv = {};
    const resultados = await Promise.all([
      provisionarChaveTef({ safeStorage, dbDir, env: primeiraEnv }),
      provisionarChaveTef({ safeStorage, dbDir, env: segundaEnv })
    ]);

    assert.strictEqual(resultados.every((resultado) => resultado.sucesso), true);
    assert.strictEqual(primeiraEnv.TEF_ENCRYPTION_KEY, segundaEnv.TEF_ENCRYPTION_KEY);
  });
}

async function testePersistenciaEntreProcessos() {
  await executarComDiretorioTemporario(async (dbDir) => {
    await provisionarChaveTef({
      safeStorage: criarSafeStorage(),
      dbDir,
      env: {}
    });
    const modulePath = path.resolve(__dirname, '../../backend/services/tef/tefSigningKeyProvisioner.js');
    const script = [
      `const { provisionarChaveTef } = require(${JSON.stringify(modulePath)});`,
      'const safeStorage = {',
      '  isEncryptionAvailable: () => true,',
      '  encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").map((byte) => byte ^ 0xa5)),',
      '  decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0xa5).toString("utf8")',
      '};',
      `provisionarChaveTef({ safeStorage, dbDir: ${JSON.stringify(dbDir)} })`,
      '  .then((result) => process.exit(result.origem === "armazenamento-protegido" ? 0 : 2))',
      '  .catch(() => process.exit(3));'
    ].join('\n');
    const childEnv = { ...process.env };
    delete childEnv.TEF_ENCRYPTION_KEY;
    delete childEnv.DESTAXA_NATIVE_HOST_ENTRY;

    const child = spawnSync(process.execPath, ['-e', script], {
      env: childEnv,
      encoding: 'utf8'
    });
    assert.strictEqual(child.status, 0, 'A chave não foi recuperada em um novo processo.');
    assert.strictEqual(child.stdout.includes('TEF_ENCRYPTION_KEY'), false);
    assert.strictEqual(child.stderr.includes('TEF_ENCRYPTION_KEY'), false);
  });
}

async function testeFalhaDeDescriptografiaNaoSubstitui() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const caminho = path.join(dbDir, KEY_FILENAME);
    fs.writeFileSync(caminho, JSON.stringify({
      versao: 1,
      algoritmo: 'electron-safeStorage',
      ciphertext: Buffer.from('ciphertext').toString('base64')
    }), 'utf8');
    const original = fs.readFileSync(caminho, 'utf8');
    const safeStorage = criarSafeStorage();
    safeStorage.decryptString = () => {
      throw new Error('erro criptográfico interno');
    };
    const env = {};

    await esperarCodigo(
      provisionarChaveTef({ safeStorage, dbDir, env }),
      'TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU'
    );
    assert.strictEqual(fs.readFileSync(caminho, 'utf8'), original);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeArquivoCorrompidoNaoSubstitui() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const caminho = path.join(dbDir, KEY_FILENAME);
    fs.writeFileSync(caminho, '{"versao":', 'utf8');
    const original = fs.readFileSync(caminho, 'utf8');
    const env = {};

    await esperarCodigo(
      provisionarChaveTef({ safeStorage: criarSafeStorage(), dbDir, env }),
      'TEF_CHAVE_ARMAZENADA_CORROMPIDA'
    );
    assert.strictEqual(fs.readFileSync(caminho, 'utf8'), original);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeEvidenciaSemChaveImpedeGeracao() {
  await executarComDiretorioTemporario(async (dbDir) => {
    await criarBancoComEvidencias(dbDir, [{
      transacao_id: 501,
      tipo: evidence.EVENTO_LIBERACAO,
      payload: { claims: {}, signature: 'assinatura-antiga' }
    }]);
    const env = {};

    await esperarCodigo(
      provisionarChaveTef({ safeStorage: criarSafeStorage(), dbDir, env }),
      'TEF_CHAVE_AUSENTE_COM_EVIDENCIA'
    );
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), false);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeChaveAmbienteIncompativelComEvidenciaNaoEArmazenada() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const chaveOriginal = crypto.randomBytes(32).toString('hex');
    process.env.TEF_ENCRYPTION_KEY = chaveOriginal;
    let payload;
    try {
      payload = criarEvidenciaAssinada(503);
    } finally {
      delete process.env.TEF_ENCRYPTION_KEY;
    }
    await criarBancoComEvidencias(dbDir, [{
      transacao_id: 503,
      tipo: evidence.EVENTO_LIBERACAO,
      payload
    }]);
    const env = { TEF_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };

    await esperarCodigo(
      provisionarChaveTef({ safeStorage: criarSafeStorage(), dbDir, env }),
      'TEF_CHAVE_AUSENTE_COM_EVIDENCIA'
    );
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), false);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeConsultaNaoCriaSchemaNoBanco() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const dbPath = await criarBancoSemTabelaTef(dbDir);
    const resultado = await provisionarChaveTef({
      safeStorage: criarSafeStorage(),
      dbDir,
      env: {}
    });

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(await tabelaTefExisteSomenteParaLeitura(dbPath), false);
  });
}

async function testeMigracaoDeChaveDeAmbienteComEvidenciaValida() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const chaveExistente = crypto.randomBytes(32).toString('hex');
    process.env.TEF_ENCRYPTION_KEY = chaveExistente;
    let payload;
    try {
      payload = criarEvidenciaAssinada(502);
    } finally {
      delete process.env.TEF_ENCRYPTION_KEY;
    }
    await criarBancoComEvidencias(dbDir, [{
      transacao_id: 502,
      tipo: evidence.EVENTO_LIBERACAO,
      payload
    }]);
    const env = { TEF_ENCRYPTION_KEY: chaveExistente };

    const resultado = await provisionarChaveTef({
      safeStorage: criarSafeStorage(),
      dbDir,
      env
    });

    assert.strictEqual(resultado.origem, 'ambiente-validado');
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, chaveExistente);
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), true);
  });
}

async function testeChaveDivergenteNaoSubstituiArmazenamento() {
  await executarComDiretorioTemporario(async (dbDir) => {
    await provisionarChaveTef({
      safeStorage: criarSafeStorage(),
      dbDir,
      env: {}
    });
    const caminho = path.join(dbDir, KEY_FILENAME);
    const original = fs.readFileSync(caminho, 'utf8');
    const env = { TEF_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };

    await esperarCodigo(
      provisionarChaveTef({ safeStorage: criarSafeStorage(), dbDir, env }),
      'TEF_CHAVE_AMBIENTE_DIVERGENTE'
    );
    assert.strictEqual(fs.readFileSync(caminho, 'utf8'), original);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeSafeStorageIndisponivelFalhaFechado() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const env = { TEF_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
    const safeStorage = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ''
    };

    await esperarCodigo(
      provisionarChaveTef({ safeStorage, dbDir, env }),
      'TEF_CHAVE_ARMAZENAMENTO_INDISPONIVEL'
    );
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), false);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeFalhaAoCriptografarNaoPersisteChave() {
  await executarComDiretorioTemporario(async (dbDir) => {
    const env = {};
    const safeStorage = criarSafeStorage();
    safeStorage.encryptString = () => {
      throw new Error('erro criptográfico interno');
    };

    await esperarCodigo(
      provisionarChaveTef({ safeStorage, dbDir, env }),
      'TEF_CHAVE_CRIPTOGRAFIA_FALHOU'
    );
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), false);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

const testes = [
  ['geração na primeira inicialização e ausência de texto puro', testePrimeiraInicializacaoEGeracao],
  ['recuperação estável após reinicialização', testeRecuperacaoNaReinicializacao],
  ['inicializações concorrentes compartilham a chave vencedora', testeInicializacaoConcorrenteCompartilhaChave],
  ['persistência entre processos', testePersistenciaEntreProcessos],
  ['falha de descriptografia sem substituição', testeFalhaDeDescriptografiaNaoSubstitui],
  ['arquivo corrompido sem substituição', testeArquivoCorrompidoNaoSubstitui],
  ['evidência prévia impede geração de nova chave', testeEvidenciaSemChaveImpedeGeracao],
  ['chave ambiente divergente da evidência nunca é armazenada', testeChaveAmbienteIncompativelComEvidenciaNaoEArmazenada],
  ['consulta de evidências não cria nem migra schema', testeConsultaNaoCriaSchemaNoBanco],
  ['migração somente com evidência validada pela chave existente', testeMigracaoDeChaveDeAmbienteComEvidenciaValida],
  ['chave divergente não substitui armazenamento', testeChaveDivergenteNaoSubstituiArmazenamento],
  ['safeStorage indisponível mantém falha fechada', testeSafeStorageIndisponivelFalhaFechado],
  ['falha de criptografia não persiste a chave', testeFalhaAoCriptografarNaoPersisteChave]
];

async function main() {
  for (const [nome, teste] of testes) {
    await teste();
    console.log(`OK ${nome}`);
  }
  console.log(`Resultado: ${testes.length}/${testes.length} testes aprovados.`);
}

main().catch((error) => {
  console.error(error && error.code ? error.code : 'Falha no teste MRT-50.17.');
  process.exitCode = 1;
});
