'use strict';

/**
 * Protocolo IPC Main ↔ TEF Native Host (Destaxa).
 *
 * REQUEST  { protocol, requestId, operation, transactionId, payload, nativeSeq, sentAt }
 * RESPONSE { protocol, requestId, transactionId, resultCode, output, error, nativeSeq }
 *
 * nativeSeq = número de chamadas nativas concluídas no host que o remetente já
 * observou. Requisição com nativeSeq menor que o do host foi enviada antes do
 * fim de uma chamada nativa → HOST_BUSY. Relógios de processos distintos não
 * são comparáveis, por isso sentAt é apenas informativo.
 */

const crypto = require('crypto');
const { CLASSIFICACAO_CODIGO, ESTADOS_TRANSACAO } = require('./destaxaConstantes');
const { FINANCIAL_STATES } = require('../tefFinancialSafetyPolicy');

const PROTOCOLO = 'cds-tef-native-host/1';

const OPERACOES_HOST = Object.freeze({
  PING: 'PING',
  STATUS: 'STATUS',
  LOAD: 'LOAD',
  INIT_CLIENT: 'INIT_CLIENT',
  ENABLE_REAL: 'ENABLE_REAL',
  TX_START: 'TX_START',
  TX_CONTINUE: 'TX_CONTINUE',
  TX_FINALIZE: 'TX_FINALIZE',
  SECURITY_BOOTSTRAP: 'SECURITY_BOOTSTRAP',
  RECONCILE: 'RECONCILE',
  UNLOAD: 'UNLOAD',
  SHUTDOWN: 'SHUTDOWN',
  // Somente com DESTAXA_NATIVE_HOST_TEST_MODE=1
  CONFIGURE_MOCK: 'CONFIGURE_MOCK',
  SIMULATE_BLOCKING: 'SIMULATE_BLOCKING',
  SIMULATE_CRASH: 'SIMULATE_CRASH'
});

/** Operações que executam código nativo (ou simulação dele) — no máximo uma ativa. */
const OPERACOES_NATIVAS = new Set([
  OPERACOES_HOST.LOAD,
  OPERACOES_HOST.INIT_CLIENT,
  OPERACOES_HOST.ENABLE_REAL,
  OPERACOES_HOST.TX_START,
  OPERACOES_HOST.TX_CONTINUE,
  OPERACOES_HOST.TX_FINALIZE,
  OPERACOES_HOST.UNLOAD,
  OPERACOES_HOST.SIMULATE_BLOCKING
]);

/** Operações que podem ter movimentação financeira em andamento. */
const OPERACOES_TRANSACIONAIS = new Set([
  OPERACOES_HOST.TX_START,
  OPERACOES_HOST.TX_CONTINUE,
  OPERACOES_HOST.TX_FINALIZE
]);

const OPERACOES_TESTE = new Set([
  OPERACOES_HOST.CONFIGURE_MOCK,
  OPERACOES_HOST.SIMULATE_BLOCKING,
  OPERACOES_HOST.SIMULATE_CRASH
]);

const ERROS_HOST = Object.freeze({
  HOST_OFFLINE: 'HOST_OFFLINE',
  HOST_CRASHED: 'HOST_CRASHED',
  HOST_UNAVAILABLE: 'HOST_UNAVAILABLE',
  HOST_BUSY: 'HOST_BUSY',
  HOST_TIMEOUT: 'HOST_TIMEOUT',
  HOST_SHUTTING_DOWN: 'HOST_SHUTTING_DOWN',
  HOST_INVALID_REQUEST: 'HOST_INVALID_REQUEST',
  HOST_OPERATION_NOT_ALLOWED: 'HOST_OPERATION_NOT_ALLOWED',
  HOST_TRANSACTION_MISMATCH: 'HOST_TRANSACTION_MISMATCH',
  HOST_TRANSACTION_ACTIVE: 'HOST_TRANSACTION_ACTIVE',
  HOST_RECONCILIATION_PENDING: 'HOST_RECONCILIATION_PENDING',
  HOST_SECURITY_BOOTSTRAP_REQUIRED: 'HOST_SECURITY_BOOTSTRAP_REQUIRED',
  HOST_SECURITY_BOOTSTRAP_INVALID: 'HOST_SECURITY_BOOTSTRAP_INVALID',
  HOST_SECURITY_OPERATION_BLOCKED: 'HOST_SECURITY_OPERATION_BLOCKED',
  HOST_INTERNAL_ERROR: 'HOST_INTERNAL_ERROR'
});

const OPERACOES_VALIDAS = new Set(Object.values(OPERACOES_HOST));
const AUTORIZACOES_RECONCILIACAO_VALIDAS = new WeakMap();
const CAMPOS_AUTORIZACAO_RECONCILIACAO = Object.freeze([
  'version',
  'authorizationId',
  'hostSessionId',
  'transactionId',
  'operation_id',
  'idempotency_key',
  'fingerprint',
  'financialState',
  'recordStatus',
  'resultStatus',
  'usuario',
  'observacao',
  'phase',
  'issuedAt'
]);
const CAMPOS_BOOTSTRAP_SEGURANCA = Object.freeze([
  'version',
  'protocol',
  'hostSessionId',
  'bootstrapId',
  'revision',
  'issuedAt',
  'recoveryComplete',
  'recoveryResult',
  'securityState',
  'blockedIdentities',
  'permit'
]);
const CAMPOS_IDENTIDADE_BLOQUEADA = Object.freeze([
  'transactionId',
  'operation_id',
  'idempotency_key',
  'fingerprint',
  'status',
  'financialState'
]);
const CAMPOS_PERMISSAO_BOOTSTRAP = Object.freeze([
  'permitId',
  'operation',
  'transactionId'
]);
const ESTADOS_BOOTSTRAP = Object.freeze({
  REQUIRED: 'SECURITY_BOOTSTRAP_REQUIRED',
  FAILED: 'SECURITY_BOOTSTRAP_FAILED',
  VALIDATED: 'SECURITY_BOOTSTRAP_VALIDATED',
  BLOCKED: 'SECURITY_BLOCKED'
});

function novoRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function texto(valor) {
  return valor == null ? null : String(valor);
}

function criarRequest(operation, payload = {}, transactionId = null, nativeSeq = 0) {
  return {
    protocol: PROTOCOLO,
    requestId: novoRequestId(),
    operation,
    transactionId: texto(transactionId),
    payload: payload || {},
    nativeSeq,
    sentAt: Date.now()
  };
}

function validarRequest(req) {
  if (!req || typeof req !== 'object') return 'request ausente';
  if (req.protocol !== PROTOCOLO) return `protocolo inválido: ${req.protocol}`;
  if (typeof req.requestId !== 'string' || !req.requestId) return 'requestId obrigatório';
  if (!OPERACOES_VALIDAS.has(req.operation)) return `operação desconhecida: ${req.operation}`;
  if (req.transactionId != null && typeof req.transactionId !== 'string') return 'transactionId deve ser string';
  if (req.payload == null || typeof req.payload !== 'object' || Array.isArray(req.payload)) return 'payload deve ser objeto';
  if (!Number.isInteger(req.nativeSeq) || req.nativeSeq < 0) return 'nativeSeq obrigatório';
  if (!Number.isFinite(req.sentAt)) return 'sentAt obrigatório';
  return null;
}

/** Remove funções/buffers — somente dados serializáveis atravessam o IPC. */
function sanitizar(valor) {
  if (valor === undefined) return null;
  return JSON.parse(JSON.stringify(valor, (_chave, v) => {
    if (typeof v === 'function') return undefined;
    if (typeof v === 'bigint') return String(v);
    if (Buffer.isBuffer(v)) return undefined;
    return v;
  }));
}

function criarResponse(req, { output = null, error = null, transactionId, nativeSeq = null } = {}) {
  const saida = sanitizar(output);
  return {
    protocol: PROTOCOLO,
    requestId: req?.requestId || null,
    transactionId: texto(transactionId !== undefined ? transactionId : req?.transactionId),
    resultCode: saida?.codigoDestaxa || saida?.codigo || null,
    output: saida,
    error: error ? { code: error.code, message: error.message || '' } : null,
    nativeSeq
  };
}

function validarResponse(res) {
  if (!res || typeof res !== 'object') return 'response ausente';
  if (res.protocol !== PROTOCOLO) return `protocolo inválido: ${res.protocol}`;
  if (typeof res.requestId !== 'string' || !res.requestId) return 'requestId obrigatório';
  if (res.error != null && typeof res.error.code !== 'string') return 'error.code obrigatório';
  return null;
}

function erroHost(code, message) {
  return { code, message };
}

function serializarClaimsAutorizacaoReconciliacao(claims) {
  return JSON.stringify(CAMPOS_AUTORIZACAO_RECONCILIACAO.map((campo) => claims[campo] ?? null));
}

function serializarClaimsBootstrapSeguranca(claims) {
  const bloqueadas = Array.isArray(claims?.blockedIdentities)
    ? claims.blockedIdentities.map((item) => CAMPOS_IDENTIDADE_BLOQUEADA.map((campo) => item?.[campo] ?? null))
    : null;
  const permissao = claims?.permit
    ? CAMPOS_PERMISSAO_BOOTSTRAP.map((campo) => claims.permit[campo] ?? null)
    : null;
  return JSON.stringify([
    ...CAMPOS_BOOTSTRAP_SEGURANCA.slice(0, 9).map((campo) => claims?.[campo] ?? null),
    bloqueadas,
    permissao
  ]);
}

function validarBootstrapSeguranca(autorizacao, chavePublica, hostSessionId, revisaoEsperada = null) {
  const claims = autorizacao?.claims;
  const chaveExata = (valor, campos) => valor
    && typeof valor === 'object'
    && !Array.isArray(valor)
    && Object.keys(valor).length === campos.length
    && campos.every((campo) => Object.prototype.hasOwnProperty.call(valor, campo));
  if (!chaveExata(claims, CAMPOS_BOOTSTRAP_SEGURANCA)
    || claims.version !== 1
    || claims.protocol !== PROTOCOLO
    || String(claims.hostSessionId || '') !== String(hostSessionId || '')
    || !/^[a-f0-9]{32}$/i.test(String(claims.bootstrapId || ''))
    || !Number.isSafeInteger(claims.revision)
    || claims.revision < 1
    || (revisaoEsperada != null && claims.revision !== revisaoEsperada)
    || !Number.isFinite(claims.issuedAt)
    || Math.abs(Date.now() - claims.issuedAt) > 5 * 60 * 1000
    || claims.recoveryComplete !== true
    || claims.recoveryResult !== 'SUCCESS'
    || !Array.isArray(claims.blockedIdentities)
    || ![ESTADOS_BOOTSTRAP.VALIDATED, ESTADOS_BOOTSTRAP.BLOCKED].includes(claims.securityState)
    || typeof autorizacao.signature !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(autorizacao.signature)) {
    return null;
  }

  const vistos = new Set();
  let anterior = null;
  for (const identidade of claims.blockedIdentities) {
    if (!chaveExata(identidade, CAMPOS_IDENTIDADE_BLOQUEADA)
      || typeof identidade.transactionId !== 'string'
      || !identidade.transactionId
      || identidade.status !== 'pendente'
      || typeof identidade.financialState !== 'string'
      || !identidade.financialState
      || [ 'operation_id', 'idempotency_key', 'fingerprint' ].some((campo) =>
        identidade[campo] != null && typeof identidade[campo] !== 'string')
      || vistos.has(identidade.transactionId)
      || (anterior != null && anterior.localeCompare(identidade.transactionId) >= 0)) {
      return null;
    }
    vistos.add(identidade.transactionId);
    anterior = identidade.transactionId;
  }

  if (claims.securityState !== (claims.blockedIdentities.length
    ? ESTADOS_BOOTSTRAP.BLOCKED
    : ESTADOS_BOOTSTRAP.VALIDATED)) {
    return null;
  }
  if (claims.permit != null
    && (!chaveExata(claims.permit, CAMPOS_PERMISSAO_BOOTSTRAP)
      || claims.permit.permitId !== claims.bootstrapId
      || !OPERACOES_TRANSACIONAIS.has(claims.permit.operation)
      || typeof claims.permit.transactionId !== 'string'
      || !claims.permit.transactionId
      || vistos.has(claims.permit.transactionId))) {
    return null;
  }

  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(chavePublica || ''), 'base64'),
      format: 'der',
      type: 'spki'
    });
    const assinatura = Buffer.from(autorizacao.signature, 'base64');
    if (!assinatura.length || assinatura.toString('base64') !== autorizacao.signature) return null;
    const assinaturaValida = crypto.verify(
      null,
      Buffer.from(serializarClaimsBootstrapSeguranca(claims), 'utf8'),
      publicKey,
      assinatura
    );
    return assinaturaValida ? JSON.parse(JSON.stringify(claims)) : null;
  } catch (_) {
    return null;
  }
}

function validarAutorizacaoReconciliacao(autorizacao, chavePublica, hostSessionId) {
  const claims = autorizacao?.claims;
  const estadosFinais = ['CONFIRMED_SUCCESS', 'CONFIRMED_DENIED', 'CANCELLED'];
  const statusEsperado = claims?.financialState === 'CONFIRMED_SUCCESS'
    ? 'aprovado'
    : claims?.financialState === 'CONFIRMED_DENIED'
      ? 'negado'
      : claims?.financialState === 'CANCELLED'
        ? 'cancelado'
        : null;
  if (!claims
    || claims.version !== 1
    || !String(claims.authorizationId || '')
    || String(claims.hostSessionId || '') !== String(hostSessionId || '')
    || !String(claims.transactionId || '')
    || ![null, undefined].includes(claims.operation_id) && typeof claims.operation_id !== 'string'
    || ![null, undefined].includes(claims.idempotency_key) && typeof claims.idempotency_key !== 'string'
    || ![null, undefined].includes(claims.fingerprint) && typeof claims.fingerprint !== 'string'
    || !estadosFinais.includes(claims.financialState)
    || claims.recordStatus !== (claims.phase === 'release' ? 'pendente' : statusEsperado)
    || claims.resultStatus !== statusEsperado
    || !String(claims.usuario || '').trim()
    || !String(claims.observacao || '').trim()
    || !['release', 'commit'].includes(claims.phase)
    || !Number.isFinite(claims.issuedAt)
    || Math.abs(Date.now() - claims.issuedAt) > 5 * 60 * 1000
    || typeof autorizacao.signature !== 'string'
    || !autorizacao.signature) {
    return null;
  }

  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(chavePublica || ''), 'base64'),
      format: 'der',
      type: 'spki'
    });
    const assinaturaValida = crypto.verify(
      null,
      Buffer.from(serializarClaimsAutorizacaoReconciliacao(claims), 'utf8'),
      publicKey,
      Buffer.from(autorizacao.signature, 'base64')
    );
    return assinaturaValida ? { ...claims } : null;
  } catch (_) {
    return null;
  }
}

function criarCapabilityAutorizacaoReconciliacao(autorizacao, chavePublica, hostSessionId) {
  const claims = validarAutorizacaoReconciliacao(autorizacao, chavePublica, hostSessionId);
  if (!claims) return null;
  const capability = Object.freeze({});
  AUTORIZACOES_RECONCILIACAO_VALIDAS.set(capability, claims);
  return capability;
}

function consumirCapabilityAutorizacaoReconciliacao(capability) {
  const claims = capability && AUTORIZACOES_RECONCILIACAO_VALIDAS.get(capability);
  if (!claims) return null;
  AUTORIZACOES_RECONCILIACAO_VALIDAS.delete(capability);
  return { ...claims };
}

/**
 * Resultado seguro quando o host não entregou resposta: nunca aprovado,
 * nunca negado — UNKNOWN/PENDING, sem retry.
 */
function resultadoHostIndisponivel(codigo, transactionId, mensagem = '') {
  return {
    sucesso: false,
    codigo,
    codigoDestaxa: codigo,
    classificacao: CLASSIFICACAO_CODIGO.UNKNOWN,
    financialState: FINANCIAL_STATES.UNKNOWN,
    estado: ESTADOS_TRANSACAO.UNKNOWN,
    mensagem: mensagem || `TEF Native Host: ${codigo}`,
    retryAllowed: false,
    retryReason: codigo,
    requerContinuacao: false,
    contexto: transactionId ? { transactionId: String(transactionId), estado: ESTADOS_TRANSACAO.UNKNOWN } : null
  };
}

module.exports = {
  PROTOCOLO,
  OPERACOES_HOST,
  OPERACOES_NATIVAS,
  OPERACOES_TRANSACIONAIS,
  OPERACOES_TESTE,
  ERROS_HOST,
  criarRequest,
  validarRequest,
  criarResponse,
  validarResponse,
  serializarClaimsAutorizacaoReconciliacao,
  serializarClaimsBootstrapSeguranca,
  validarBootstrapSeguranca,
  ESTADOS_BOOTSTRAP,
  validarAutorizacaoReconciliacao,
  criarCapabilityAutorizacaoReconciliacao,
  consumirCapabilityAutorizacaoReconciliacao,
  sanitizar,
  erroHost,
  resultadoHostIndisponivel
};
