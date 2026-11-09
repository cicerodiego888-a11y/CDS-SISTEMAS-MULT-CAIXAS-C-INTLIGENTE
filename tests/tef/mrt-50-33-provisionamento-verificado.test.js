'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

async function comDiretorioDeChaveTemporario(teste) {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt-50-33-key-'));
  try {
    await teste(dbDir);
    assert.strictEqual(fs.existsSync(path.join(dbDir, 'mercadao.db')), false);
  } finally {
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
}

async function testePersistirLerERecuperarSemBanco() {
  await comDiretorioDeChaveTemporario(async (dbDir) => {
    const safeStorage = criarSafeStorage();
    const primeiraEnv = {};
    const primeira = await provisionarChaveTef({
      safeStorage,
      dbDir,
      env: primeiraEnv
    });
    const caminho = path.join(dbDir, KEY_FILENAME);
    const conteudo = fs.readFileSync(caminho, 'utf8');

    assert.strictEqual(primeira.origem, 'gerada');
    assert.match(primeiraEnv.TEF_ENCRYPTION_KEY, /^[a-f0-9]{64}$/i);
    assert.strictEqual(conteudo.includes(primeiraEnv.TEF_ENCRYPTION_KEY), false);

    const segundaEnv = {};
    const segunda = await provisionarChaveTef({
      safeStorage,
      dbDir,
      env: segundaEnv
    });

    assert.strictEqual(segunda.origem, 'armazenamento-protegido');
    assert.strictEqual(segundaEnv.TEF_ENCRYPTION_KEY, primeiraEnv.TEF_ENCRYPTION_KEY);
  });
}

async function testeFalhaNoRoundTripNaoPersisteChave() {
  await comDiretorioDeChaveTemporario(async (dbDir) => {
    const safeStorage = criarSafeStorage();
    safeStorage.decryptString = () => {
      throw new Error('falha sintética de round-trip');
    };
    const env = {};

    await assert.rejects(
      provisionarChaveTef({ safeStorage, dbDir, env }),
      (error) => error.code === 'TEF_CHAVE_VERIFICACAO_FALHOU'
    );
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), false);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeFalhaNaReleituraNaoDisponibilizaChave() {
  await comDiretorioDeChaveTemporario(async (dbDir) => {
    const safeStorage = criarSafeStorage();
    const decryptOriginal = safeStorage.decryptString;
    let chamadas = 0;
    safeStorage.decryptString = (ciphertext) => {
      chamadas += 1;
      if (chamadas === 2) throw new Error('falha sintética na releitura');
      return decryptOriginal(ciphertext);
    };
    const env = {};

    await assert.rejects(
      provisionarChaveTef({ safeStorage, dbDir, env }),
      (error) => error.code === 'TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU'
    );
    assert.strictEqual(fs.existsSync(path.join(dbDir, KEY_FILENAME)), true);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function testeArmazenamentoExistenteInvalidoPermaneceIntacto() {
  await comDiretorioDeChaveTemporario(async (dbDir) => {
    const caminho = path.join(dbDir, KEY_FILENAME);
    const original = JSON.stringify({
      versao: 1,
      algoritmo: 'electron-safeStorage',
      ciphertext: Buffer.from('ciphertext inválido').toString('base64')
    });
    fs.writeFileSync(caminho, original, 'utf8');
    const env = {};

    await assert.rejects(
      provisionarChaveTef({
        safeStorage: criarSafeStorage(),
        dbDir,
        env
      }),
      (error) => ['TEF_CHAVE_DESCRIPTOGRAFIA_FALHOU', 'TEF_CHAVE_INVALIDA'].includes(error.code)
    );
    assert.strictEqual(fs.readFileSync(caminho, 'utf8'), original);
    assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  });
}

async function main() {
  const tests = [
    ['persistência e recuperação sem banco', testePersistirLerERecuperarSemBanco],
    ['round-trip falho não persiste chave', testeFalhaNoRoundTripNaoPersisteChave],
    ['releitura falha não disponibiliza chave', testeFalhaNaReleituraNaoDisponibilizaChave],
    ['armazenamento inválido não é substituído', testeArmazenamentoExistenteInvalidoPermaneceIntacto]
  ];

  for (const [name, test] of tests) {
    await test();
    console.log(`PASS ${name}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
