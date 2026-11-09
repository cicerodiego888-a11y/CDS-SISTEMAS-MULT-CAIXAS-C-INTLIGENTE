'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.NODE_ENV = 'test';
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
delete process.env.DESTAXA_NATIVE_HOST_ENTRY;
const TEST_KEY = crypto.randomBytes(32).toString('hex');
const DEV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.TEF_ENCRYPTION_KEY = TEST_KEY;

const evidence = require('../../backend/services/tef/tefReconciliationEvidence');
const protocol = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

const identidade = {
  transactionId: 'mrt50.12-isolated',
  operation_id: 'op-mrt50.12-isolated',
  idempotency_key: 'idem-mrt50.12-isolated',
  fingerprint: 'fp-mrt50.12-isolated'
};

function criarClaimsEvidencia(overrides = {}) {
  return {
    version: 1,
    evidenceId: '11112222333344445555666677778888',
    eventType: evidence.EVENTO_LIBERACAO,
    transacao_id: identidade.transactionId,
    transactionId: identidade.transactionId,
    operation_id: identidade.operation_id,
    idempotency_key: identidade.idempotency_key,
    fingerprint: identidade.fingerprint,
    financialState: 'CONFIRMED_SUCCESS',
    resultStatus: 'aprovado',
    usuario: 'mrt50.12-isolated-test',
    timestamp: new Date().toISOString(),
    releaseEvidenceId: null,
    releaseTimestamp: null,
    ...overrides
  };
}

function criarClaimsAutorizacao(overrides = {}) {
  return {
    version: 1,
    authorizationId: 'aabbccddeeff00112233445566778899',
    hostSessionId: 'mrt50.12-host-session',
    ...identidade,
    financialState: 'CONFIRMED_SUCCESS',
    recordStatus: 'pendente',
    resultStatus: 'aprovado',
    usuario: 'mrt50.12-isolated-test',
    observacao: 'isolated verification',
    phase: 'release',
    issuedAt: Date.now(),
    ...overrides
  };
}

function criarClaimsBootstrap(overrides = {}) {
  return {
    version: 1,
    protocol: protocol.PROTOCOLO,
    hostSessionId: 'mrt50.12-host-session',
    bootstrapId: '00112233445566778899aabbccddeeff',
    revision: 1,
    issuedAt: Date.now(),
    recoveryComplete: true,
    recoveryResult: 'SUCCESS',
    securityState: protocol.ESTADOS_BOOTSTRAP.VALIDATED,
    blockedIdentities: [],
    permit: null,
    ...overrides
  };
}

const signers = [
  ['evidência', (claims) => evidence.assinarEvidencia(claims), criarClaimsEvidencia],
  ['autorização', (claims) => evidence.assinarAutorizacaoReconciliacao(claims), criarClaimsAutorizacao],
  ['bootstrap', (claims) => evidence.assinarBootstrapSeguranca(claims), criarClaimsBootstrap]
];
const resultados = [];

function caso(nome, executar) {
  try {
    executar();
    resultados.push({ nome, status: 'PASSOU' });
  } catch (error) {
    resultados.push({ nome, status: 'FALHOU', erro: error.stack || error.message });
  }
}

caso('Claims válidos dos três contratos são assinados', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  for (const [nome, assinar, criarClaims] of signers) {
    const assinatura = assinar(criarClaims());
    assert.strictEqual(typeof assinatura.signature, 'string', nome);
    assert.ok(assinatura.signature.length > 0, nome);
  }
});

caso('Claims inválidos de evidência são rejeitados na fronteira', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarEvidencia(criarClaimsEvidencia({ resultStatus: 'negado' })),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
});

caso('Tipo de evento não permitido é rejeitado', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarEvidencia(criarClaimsEvidencia({ eventType: 'EVENTO_ARBITRARIO' })),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
});

caso('Identidade incompleta é rejeitada', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarEvidencia(criarClaimsEvidencia({ fingerprint: '' })),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
});

caso('Timestamp inválido é rejeitado', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarEvidencia(criarClaimsEvidencia({ timestamp: 'não-é-data' })),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
});

caso('COMMIT sem vínculo RELEASE válido é rejeitado', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarEvidencia(criarClaimsEvidencia({
      eventType: evidence.EVENTO_COMMIT,
      releaseEvidenceId: null,
      releaseTimestamp: null
    })),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
});

caso('Autorização rejeita claims de evidência', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarAutorizacaoReconciliacao(criarClaimsEvidencia()),
    (error) => error.code === 'TEF_RECONCILIACAO_AUTORIZACAO_INVALIDA'
  );
});

caso('Autorização rejeita identidade incompleta e fase/status divergentes', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  for (const claims of [
    criarClaimsAutorizacao({ idempotency_key: null }),
    criarClaimsAutorizacao({ phase: 'bootstrap' }),
    criarClaimsAutorizacao({ phase: 'commit', recordStatus: 'pendente' })
  ]) {
    assert.throws(
      () => evidence.assinarAutorizacaoReconciliacao(claims),
      (error) => error.code === 'TEF_RECONCILIACAO_AUTORIZACAO_INVALIDA'
    );
  }
});

caso('Bootstrap rejeita claims de autorização', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarBootstrapSeguranca(criarClaimsAutorizacao()),
    (error) => error.code === 'TEF_RECONCILIACAO_BOOTSTRAP_INVALIDO'
  );
});

caso('Bootstrap rejeita recuperação incompleta e permissão transacional inválida', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  for (const claims of [
    criarClaimsBootstrap({ recoveryComplete: false }),
    criarClaimsBootstrap({
      permit: {
        permitId: '00112233445566778899aabbccddeeff',
        operation: 'PING',
        transactionId: identidade.transactionId
      }
    })
  ]) {
    assert.throws(
      () => evidence.assinarBootstrapSeguranca(claims),
      (error) => error.code === 'TEF_RECONCILIACAO_BOOTSTRAP_INVALIDO'
    );
  }
});

caso('Claims arbitrários e propriedades extras não são assinados', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  assert.throws(
    () => evidence.assinarEvidencia({ arbitrary: 'value' }),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
  assert.throws(
    () => evidence.assinarEvidencia(criarClaimsEvidencia({ extra: true })),
    (error) => error.code === 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA'
  );
  assert.throws(
    () => evidence.assinarAutorizacaoReconciliacao(criarClaimsAutorizacao({ extra: true })),
    (error) => error.code === 'TEF_RECONCILIACAO_AUTORIZACAO_INVALIDA'
  );
  assert.throws(
    () => evidence.assinarBootstrapSeguranca(criarClaimsBootstrap({ extra: true })),
    (error) => error.code === 'TEF_RECONCILIACAO_BOOTSTRAP_INVALIDO'
  );
});

caso('Segredo ausente bloqueia os três assinadores', () => {
  delete process.env.TEF_ENCRYPTION_KEY;
  for (const [nome, assinar, criarClaims] of signers) {
    assert.throws(
      () => assinar(criarClaims()),
      (error) => error.code === 'TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO',
      nome
    );
  }
});

caso('Segredo malformado bloqueia os três assinadores', () => {
  process.env.TEF_ENCRYPTION_KEY = 'not-hex';
  for (const [nome, assinar, criarClaims] of signers) {
    assert.throws(
      () => assinar(criarClaims()),
      (error) => error.code === 'TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO',
      nome
    );
  }
});

caso('Chave fixa de desenvolvimento é bloqueada nos três assinadores', () => {
  process.env.TEF_ENCRYPTION_KEY = DEV_KEY;
  for (const [nome, assinar, criarClaims] of signers) {
    assert.throws(
      () => assinar(criarClaims()),
      (error) => error.code === 'TEF_RECONCILIACAO_CHAVE_DEV_PROIBIDA',
      nome
    );
  }
});

caso('Evidência válida verifica e evidência adulterada é rejeitada', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidence.obterChavePublica();
  const claims = criarClaimsEvidencia();
  const assinada = evidence.assinarEvidencia(claims);
  assert.deepStrictEqual(
    evidence.validarEvidencia(assinada, evidence.EVENTO_LIBERACAO, publicKey),
    claims
  );
  assert.strictEqual(
    evidence.validarEvidencia({
      ...assinada,
      claims: { ...claims, financialState: 'CONFIRMED_DENIED' }
    }, evidence.EVENTO_LIBERACAO, publicKey),
    null
  );
  assert.strictEqual(
    evidence.validarEvidenciaTransacao(
      assinada,
      evidence.EVENTO_LIBERACAO,
      { ...identidade, fingerprint: 'different-fingerprint' },
      publicKey
    ),
    null
  );
});

caso('Falha de configuração mantém TefManager indisponível e CDS importável', () => {
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt-50-12-'));
  const script = [
    "const assert=require('assert');",
    "const immediate=global.setImmediate;",
    "global.setImmediate=()=>({unref(){}});",
    "const mod=require('./backend/services/tef/TefManager');",
    "global.setImmediate=immediate;",
    "require('./backend/services/crypto/cryptoService');",
    "const calls={driver:0,publicKey:0};",
    "const client={configurarChavePublicaReconciliacao(){calls.publicKey++;},configurarProvedorBootstrapSeguranca(){},};",
    "const manager=new mod.TefManager({recuperarNoInicio:false,nativeHostClient:client});",
    "assert.deepStrictEqual(manager.obterEstadoConfiguracaoCriptografica(),{estado:'INDISPONIVEL',disponivel:false,codigo:'TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO'});",
    "async function run(){",
    "assert.strictEqual((await manager.autorizar({})).codigo,'TEF_CRIPTOGRAFIA_INDISPONIVEL');",
    "assert.strictEqual((await manager.continuarAutorizacao({})).codigo,'TEF_CRIPTOGRAFIA_INDISPONIVEL');",
    "assert.strictEqual((await manager.cancelar('mrt50.12')) .codigo,'TEF_CRIPTOGRAFIA_INDISPONIVEL');",
    "for(const fn of [()=>manager._criarBootstrapSeguranca(),()=>manager.reconciliarResultadoTardio('mrt50.12'),()=>manager.reconciliarNativeHost('mrt50.12')]){",
    "await assert.rejects(fn(),e=>e.code==='TEF_CRIPTOGRAFIA_INDISPONIVEL');}",
    "assert.strictEqual(calls.driver,0); assert.strictEqual(calls.publicKey,0);",
    "const db=require('./backend/database');",
    "db.close(err=>{if(err){console.error(err);process.exitCode=1;}else console.log('MRT50_12_MANAGER_OK');});",
    "}",
    "run().catch(e=>{console.error(e);process.exitCode=1;});"
  ].join('');
  const env = { ...process.env, NODE_ENV: 'test', DB_DIR: databaseDir, DESTAXA_REAL_TRANSACTION_ENABLED: '0' };
  delete env.TEF_ENCRYPTION_KEY;
  delete env.DESTAXA_NATIVE_HOST_ENTRY;
  const processo = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../..'),
    env,
    encoding: 'utf8',
    timeout: 20000
  });
  try {
    assert.strictEqual(processo.status, 0, processo.stderr || processo.stdout);
    assert.ok(processo.stdout.includes('MRT50_12_MANAGER_OK'), processo.stdout);
    assert.ok(processo.stdout.includes(path.join(databaseDir, 'mercadao.db')), processo.stdout);
    assert.strictEqual(env.DESTAXA_REAL_TRANSACTION_ENABLED, '0');
  } finally {
    fs.rmSync(databaseDir, { recursive: true, force: true });
  }
});

caso('Chave pública e assinatura verificável sem exportar chave privada', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidence.obterChavePublica();
  const assinada = evidence.assinarAutorizacaoReconciliacao(criarClaimsAutorizacao());
  assert.strictEqual(
    protocol.validarAutorizacaoReconciliacao(
      assinada,
      publicKey,
      assinada.claims.hostSessionId
    )?.authorizationId,
    assinada.claims.authorizationId
  );
  assert.strictEqual('obterParChavesReconciliacao' in evidence, false);
  assert.strictEqual(crypto.createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    format: 'der',
    type: 'spki'
  }).asymmetricKeyType, 'ed25519');
});

const falhas = resultados.filter((resultado) => resultado.status !== 'PASSOU');
console.log(JSON.stringify({ resultados, total: resultados.length, falhas: falhas.length }, null, 2));
if (falhas.length) process.exitCode = 1;
