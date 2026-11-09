'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
delete process.env.DESTAXA_NATIVE_HOST_ENTRY;
const TEST_KEY = crypto.randomBytes(32).toString('hex');
const DEV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const HISTORICAL_PUBLIC_KEY = 'MCowBQYDK2VwAyEAHHcGURji5eIY2nZiiDfrETn4iUnGTYFzCK/pHhF4+7s=';
process.env.TEF_ENCRYPTION_KEY = TEST_KEY;

const evidenceService = require('../../backend/services/tef/tefReconciliationEvidence');
const cryptoService = require('../../backend/services/crypto/cryptoService');
const nativeProtocol = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { criarAmbienteNativeHost } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');

const identidade = {
  transactionId: 'mrt50.11-historical',
  operation_id: 'op-mrt50.11-historical',
  idempotency_key: 'idem-mrt50.11-historical',
  fingerprint: 'fp-mrt50.11-historical'
};
const claims = {
  version: 1,
  evidenceId: '11112222333344445555666677778888',
  eventType: evidenceService.EVENTO_LIBERACAO,
  transacao_id: identidade.transactionId,
  transactionId: identidade.transactionId,
  operation_id: identidade.operation_id,
  idempotency_key: identidade.idempotency_key,
  fingerprint: identidade.fingerprint,
  financialState: 'CONFIRMED_SUCCESS',
  resultStatus: 'aprovado',
  usuario: 'mrt50.11-isolated-test',
  timestamp: '2025-01-02T03:04:05.000Z',
  releaseEvidenceId: null,
  releaseTimestamp: null
};

const historicalRelease = {
  claims: {
    version: 1,
    evidenceId: '00112233445566778899aabbccddeeff',
    eventType: 'TEF_RECONCILIACAO_LIBERADA',
    transacao_id: 'historical-mrt5011',
    transactionId: 'historical-mrt5011',
    operation_id: 'op-historical-mrt5011',
    idempotency_key: 'idem-historical-mrt5011',
    fingerprint: 'fp-historical-mrt5011',
    financialState: 'CONFIRMED_SUCCESS',
    resultStatus: 'aprovado',
    usuario: 'mrt50.11-historical-fixture',
    timestamp: '2025-01-02T03:04:05.000Z',
    releaseEvidenceId: null,
    releaseTimestamp: null
  },
  signature: 'XKS/cjxCW0O0BRgcHpo3tL/TfaL/AsEpUJuT7DeuzAdVvuyhRc39ElOQxW2GMzcUCKQHf1tcLGpyZRvnH+2wCg=='
};
const historicalCommit = {
  claims: {
    ...historicalRelease.claims,
    evidenceId: 'ffeeddccbbaa99887766554433221100',
    eventType: 'TEF_RECONCILIACAO_COMMIT_CONFIRMADO',
    timestamp: '2025-01-02T03:05:05.000Z',
    releaseEvidenceId: historicalRelease.claims.evidenceId,
    releaseTimestamp: historicalRelease.claims.timestamp
  },
  signature: '9oUBvEAlc25ZRSPE9LdYVy4AEN21vxm5peNofvARjAhSj+OSTsOc1gtjX3E1ATh9gUXxeFdxC23JXHsR1P35BQ=='
};

const resultados = [];

function caso(nome, executar) {
  try {
    executar();
    resultados.push({ nome, status: 'PASSOU' });
  } catch (error) {
    resultados.push({ nome, status: 'FALHOU', erro: error.stack || error.message });
  }
}

caso('Chave ausente bloqueia assinatura em NODE_ENV=test', () => {
  delete process.env.TEF_ENCRYPTION_KEY;
  assert.throws(
    () => evidenceService.assinarEvidencia(claims),
    (error) => error.code === 'TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO'
  );
});

caso('Chave malformada bloqueia assinatura', () => {
  process.env.TEF_ENCRYPTION_KEY = 'not-hex';
  assert.throws(
    () => evidenceService.assinarEvidencia(claims),
    (error) => error.code === 'TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO'
  );
});

caso('Chave de desenvolvimento fixa jamais assina', () => {
  process.env.TEF_ENCRYPTION_KEY = DEV_KEY;
  assert.throws(
    () => evidenceService.assinarEvidencia(claims),
    (error) => error.code === 'TEF_RECONCILIACAO_CHAVE_DEV_PROIBIDA'
  );
});

caso('Chave válida assina e verifica evidência', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidenceService.obterChavePublica();
  const signed = evidenceService.assinarEvidencia(claims);
  const verifier = crypto.createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    format: 'der',
    type: 'spki'
  });
  assert.strictEqual(
    crypto.verify(
      null,
      Buffer.from(JSON.stringify([
        claims.version,
        claims.evidenceId,
        claims.eventType,
        claims.transacao_id,
        claims.transactionId,
        claims.operation_id,
        claims.idempotency_key,
        claims.fingerprint,
        claims.financialState,
        claims.resultStatus,
        claims.usuario,
        claims.timestamp,
        claims.releaseEvidenceId,
        claims.releaseTimestamp
      ]), 'utf8'),
      verifier,
      Buffer.from(signed.signature, 'base64')
    ),
    true
  );
  assert.deepStrictEqual(
    evidenceService.validarEvidencia(signed, evidenceService.EVENTO_LIBERACAO, publicKey),
    claims
  );
});

caso('Evidência adulterada é rejeitada', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidenceService.obterChavePublica();
  const signed = evidenceService.assinarEvidencia(claims);
  const adulterada = {
    ...signed,
    claims: { ...signed.claims, financialState: 'CONFIRMED_DENIED' }
  };
  assert.strictEqual(
    evidenceService.validarEvidencia(adulterada, evidenceService.EVENTO_LIBERACAO, publicKey),
    null
  );
});

caso('Evidência assinada com identidade divergente é rejeitada', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidenceService.obterChavePublica();
  const signed = evidenceService.assinarEvidencia(claims);
  assert.strictEqual(
    evidenceService.validarEvidenciaTransacao(
      signed,
      evidenceService.EVENTO_LIBERACAO,
      { ...identidade, fingerprint: 'fingerprint-divergente' },
      publicKey
    ),
    null
  );
});

caso('NativeHost não pode derivar chave privada', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  process.env.DESTAXA_NATIVE_HOST_ENTRY = '1';
  assert.throws(
    () => evidenceService.assinarEvidencia(claims),
    (error) => error.code === 'TEF_RECONCILIACAO_DERIVACAO_NATIVEHOST_PROIBIDA'
  );
  delete process.env.DESTAXA_NATIVE_HOST_ENTRY;
  assert.strictEqual(cryptoService.derivarChaveEd25519, undefined);
});

caso('Ambiente NativeHost recebe chave pública e exclui segredos', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidenceService.obterChavePublica();
  const env = criarAmbienteNativeHost(
    {
      NODE_ENV: 'test',
      TEF_ENCRYPTION_KEY: TEST_KEY,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0'
    },
    {
      TEF_ENCRYPTION_KEY: DEV_KEY,
      DESTAXA_PRIVATE_KEY: 'must-not-be-forwarded'
    },
    publicKey
  );
  assert.strictEqual(env.DESTAXA_RECONCILIATION_PUBLIC_KEY, publicKey);
  assert.strictEqual(env.TEF_ENCRYPTION_KEY, undefined);
  assert.strictEqual(env.DESTAXA_PRIVATE_KEY, undefined);
  assert.strictEqual(env.DESTAXA_NATIVE_HOST_ENTRY, '1');
});

caso('NativeHost verifica autorização e bootstrap usando apenas chave pública', () => {
  process.env.TEF_ENCRYPTION_KEY = TEST_KEY;
  const publicKey = evidenceService.obterChavePublica();
  const authorizationClaims = {
    version: 1,
    authorizationId: 'aabbccddeeff00112233445566778899',
    hostSessionId: 'mrt50.11-host-session',
    transactionId: identidade.transactionId,
    operation_id: identidade.operation_id,
    idempotency_key: identidade.idempotency_key,
    fingerprint: identidade.fingerprint,
    financialState: 'CONFIRMED_SUCCESS',
    recordStatus: 'pendente',
    resultStatus: 'aprovado',
    usuario: 'mrt50.11-isolated-test',
    observacao: 'isolated verification',
    phase: 'release',
    issuedAt: Date.now()
  };
  const authorization = evidenceService.assinarAutorizacaoReconciliacao(authorizationClaims);
  assert.deepStrictEqual(
    nativeProtocol.validarAutorizacaoReconciliacao(
      authorization,
      publicKey,
      authorizationClaims.hostSessionId
    ),
    authorizationClaims
  );

  const bootstrapClaims = {
    version: 1,
    protocol: nativeProtocol.PROTOCOLO,
    hostSessionId: authorizationClaims.hostSessionId,
    bootstrapId: '00112233445566778899aabbccddeeff',
    revision: 1,
    issuedAt: Date.now(),
    recoveryComplete: true,
    recoveryResult: 'SUCCESS',
    securityState: nativeProtocol.ESTADOS_BOOTSTRAP.VALIDATED,
    blockedIdentities: [],
    permit: null
  };
  const bootstrap = evidenceService.assinarBootstrapSeguranca(bootstrapClaims);
  assert.deepStrictEqual(
    nativeProtocol.validarBootstrapSeguranca(
      bootstrap,
      publicKey,
      bootstrapClaims.hostSessionId,
      bootstrapClaims.revision
    ),
    bootstrapClaims
  );
});

caso('RELEASE e COMMIT históricos continuam verificáveis com a chave de teste', () => {
  assert.ok(evidenceService.validarEvidencia(
    historicalRelease,
    evidenceService.EVENTO_LIBERACAO,
    HISTORICAL_PUBLIC_KEY
  ));
  assert.ok(evidenceService.validarEvidencia(
    historicalCommit,
    evidenceService.EVENTO_COMMIT,
    HISTORICAL_PUBLIC_KEY
  ));
  assert.strictEqual(
    historicalCommit.claims.releaseEvidenceId,
    historicalRelease.claims.evidenceId
  );
});

caso('TefManager e NativeHost não importam nem armazenam chave privada', () => {
  const root = path.resolve(__dirname, '../..');
  const managerSource = fs.readFileSync(
    path.join(root, 'backend/services/tef/TefManager.js'),
    'utf8'
  );
  const hostSource = fs.readFileSync(
    path.join(root, 'backend/services/tef/destaxa/DestaxaNativeHost.js'),
    'utf8'
  );
  assert.doesNotMatch(managerSource, /obterParChavesReconciliacao|privateKey|CHAVES_AUTORIZACAO_RECONCILIACAO/);
  assert.doesNotMatch(hostSource, /TEF_ENCRYPTION_KEY|derivarChaveEd25519|privateKey/);
  assert.strictEqual('obterParChavesReconciliacao' in evidenceService, false);
  assert.strictEqual(typeof evidenceService.obterChavePublica(), 'string');
});

caso('Nenhum NativeHost ou driver financeiro foi iniciado', () => {
  assert.strictEqual(process.env.DESTAXA_REAL_TRANSACTION_ENABLED, '0');
  const hostPath = require.resolve('../../backend/services/tef/destaxa/DestaxaNativeHost');
  assert.strictEqual(require.cache[hostPath], undefined);
});

const falhas = resultados.filter((resultado) => resultado.status !== 'PASSOU');
console.log(JSON.stringify({ resultados, total: resultados.length, falhas: falhas.length }, null, 2));
if (falhas.length) process.exitCode = 1;
