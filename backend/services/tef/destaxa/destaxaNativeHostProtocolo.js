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
  HOST_INTERNAL_ERROR: 'HOST_INTERNAL_ERROR'
});

const OPERACOES_VALIDAS = new Set(Object.values(OPERACOES_HOST));

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
  sanitizar,
  erroHost,
  resultadoHostIndisponivel
};
