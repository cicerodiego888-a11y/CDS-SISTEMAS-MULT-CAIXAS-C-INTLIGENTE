'use strict';

const crypto = require('crypto');
const {
  serializarClaimsAutorizacaoReconciliacao,
  serializarClaimsBootstrapSeguranca,
  OPERACOES_TRANSACIONAIS,
  ESTADOS_BOOTSTRAP,
  PROTOCOLO
} = require('./destaxa/destaxaNativeHostProtocolo');

const EVENTO_LIBERACAO = 'TEF_RECONCILIACAO_LIBERADA';
const EVENTO_COMMIT = 'TEF_RECONCILIACAO_COMMIT_CONFIRMADO';
const CONTEXTO_CHAVE = 'CDS:TEF:ED25519:reconciliation-evidence-v1';
const CHAVE_DEV_FIXA_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PREFIXO_PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const CAMPOS_EVIDENCIA = Object.freeze([
  'version',
  'evidenceId',
  'eventType',
  'transacao_id',
  'transactionId',
  'operation_id',
  'idempotency_key',
  'fingerprint',
  'financialState',
  'resultStatus',
  'usuario',
  'timestamp',
  'releaseEvidenceId',
  'releaseTimestamp'
]);
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
const CAMPOS_BOOTSTRAP = Object.freeze([
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
const ESTADOS_POR_STATUS = Object.freeze({
  CONFIRMED_SUCCESS: 'aprovado',
  CONFIRMED_DENIED: 'negado',
  CANCELLED: 'cancelado'
});

function chaveDesenvolvimentoProibida(segredo) {
  return typeof segredo === 'string' && segredo.toLowerCase() === CHAVE_DEV_FIXA_HEX;
}

function derivarChavePrivada() {
  if (process.env.DESTAXA_NATIVE_HOST_ENTRY === '1') {
    const error = new Error('Derivação da chave privada Ed25519 proibida no NativeHost');
    error.code = 'TEF_RECONCILIACAO_DERIVACAO_NATIVEHOST_PROIBIDA';
    throw error;
  }

  const segredo = process.env.TEF_ENCRYPTION_KEY;
  if (typeof segredo !== 'string' || !/^[a-f0-9]{64}$/i.test(segredo)) {
    const error = new Error('TEF_ENCRYPTION_KEY válido é obrigatório para assinar evidências TEF');
    error.code = 'TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO';
    throw error;
  }
  if (chaveDesenvolvimentoProibida(segredo)) {
    const error = new Error('A chave fixa de desenvolvimento não pode assinar evidências TEF');
    error.code = 'TEF_RECONCILIACAO_CHAVE_DEV_PROIBIDA';
    throw error;
  }

  const seed = crypto.createHmac('sha256', Buffer.from(segredo, 'hex'))
    .update(CONTEXTO_CHAVE, 'utf8')
    .digest();
  return crypto.createPrivateKey({
    key: Buffer.concat([PREFIXO_PKCS8_ED25519, seed]),
    format: 'der',
    type: 'pkcs8'
  });
}

function assinar(serializado) {
  return crypto.sign(null, Buffer.from(serializado, 'utf8'), derivarChavePrivada())
    .toString('base64');
}

function serializarClaimsEvidencia(claims) {
  return JSON.stringify(CAMPOS_EVIDENCIA.map((campo) => claims?.[campo] ?? null));
}

function timestampValido(timestamp) {
  if (typeof timestamp !== 'string') return false;
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === timestamp;
}

function criarClaimsEvidencia({
  eventType,
  identidade,
  financialState,
  resultStatus,
  usuario,
  timestamp = new Date().toISOString(),
  releaseEvidenceId = null,
  releaseTimestamp = null
}) {
  const transactionId = String(identidade?.transactionId || '');
  const claims = {
    version: 1,
    evidenceId: crypto.randomBytes(16).toString('hex'),
    eventType,
    transacao_id: transactionId,
    transactionId,
    operation_id: String(identidade?.operation_id || ''),
    idempotency_key: String(identidade?.idempotency_key || ''),
    fingerprint: String(identidade?.fingerprint || ''),
    financialState: String(financialState || ''),
    resultStatus: String(resultStatus || ''),
    usuario: String(usuario || ''),
    timestamp,
    releaseEvidenceId,
    releaseTimestamp
  };
  if (!claims.evidenceId
    || !claims.transacao_id
    || !claims.operation_id
    || !claims.idempotency_key
    || !claims.fingerprint
    || !ESTADOS_POR_STATUS[claims.financialState]
    || ESTADOS_POR_STATUS[claims.financialState] !== claims.resultStatus
    || !claims.usuario.trim()
    || !timestampValido(claims.timestamp)
    || (eventType === EVENTO_LIBERACAO
      && (releaseEvidenceId !== null || releaseTimestamp !== null))
    || (eventType === EVENTO_COMMIT
      && (!releaseEvidenceId || !timestampValido(releaseTimestamp)
        || Date.parse(timestamp) < Date.parse(releaseTimestamp)))
    || ![EVENTO_LIBERACAO, EVENTO_COMMIT].includes(eventType)) {
    const error = new Error('Dados incompletos ou inválidos para evidência de reconciliação');
    error.code = 'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA';
    throw error;
  }
  return claims;
}

function chaveExata(valor, campos) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(valor))) return false;
    const chaves = Reflect.ownKeys(valor);
    return chaves.length === campos.length
      && campos.every((campo) => {
        const descritor = Object.getOwnPropertyDescriptor(valor, campo);
        return descritor
          && descritor.enumerable
          && Object.prototype.hasOwnProperty.call(descritor, 'value');
      });
  } catch (_) {
    return false;
  }
}

function validarClaimsEvidencia(claims) {
  const estadoValido = typeof claims?.financialState === 'string'
    && Object.prototype.hasOwnProperty.call(ESTADOS_POR_STATUS, claims.financialState);
  return chaveExata(claims, CAMPOS_EVIDENCIA)
    && claims.version === 1
    && [EVENTO_LIBERACAO, EVENTO_COMMIT].includes(claims.eventType)
    && typeof claims.evidenceId === 'string'
    && /^[a-f0-9]{32}$/i.test(claims.evidenceId)
    && typeof claims.transacao_id === 'string'
    && claims.transacao_id.trim() !== ''
    && claims.transactionId === claims.transacao_id
    && ['operation_id', 'idempotency_key', 'fingerprint', 'usuario'].every((campo) =>
      typeof claims[campo] === 'string' && claims[campo].trim() !== '')
    && estadoValido
    && claims.resultStatus === ESTADOS_POR_STATUS[claims.financialState]
    && timestampValido(claims.timestamp)
    && (claims.eventType === EVENTO_LIBERACAO
      ? claims.releaseEvidenceId === null && claims.releaseTimestamp === null
      : typeof claims.releaseEvidenceId === 'string'
        && /^[a-f0-9]{32}$/i.test(claims.releaseEvidenceId)
        && timestampValido(claims.releaseTimestamp)
        && Date.parse(claims.timestamp) >= Date.parse(claims.releaseTimestamp));
}

function statusAutorizacaoEsperado(financialState) {
  return ESTADOS_POR_STATUS[financialState] || null;
}

function validarClaimsAutorizacaoReconciliacao(claims) {
  if (!chaveExata(claims, CAMPOS_AUTORIZACAO_RECONCILIACAO)) return false;
  const statusEsperado = statusAutorizacaoEsperado(claims.financialState);
  return claims.version === 1
    && typeof claims.authorizationId === 'string'
    && /^[a-f0-9]{32}$/i.test(claims.authorizationId)
    && typeof claims.hostSessionId === 'string'
    && claims.hostSessionId.trim() !== ''
    && typeof claims.transactionId === 'string'
    && claims.transactionId.trim() !== ''
    && ['operation_id', 'idempotency_key', 'fingerprint', 'usuario', 'observacao'].every((campo) =>
      typeof claims[campo] === 'string' && claims[campo].trim() !== '')
    && statusEsperado !== null
    && ['release', 'commit'].includes(claims.phase)
    && claims.recordStatus === (claims.phase === 'release' ? 'pendente' : statusEsperado)
    && claims.resultStatus === statusEsperado
    && Number.isFinite(claims.issuedAt)
    && Math.abs(Date.now() - claims.issuedAt) <= 5 * 60 * 1000;
}

function validarIdentidadesBootstrap(identidades) {
  if (!Array.isArray(identidades)) return false;
  const vistos = new Set();
  let anterior = null;
  for (const identidade of identidades) {
    if (!chaveExata(identidade, CAMPOS_IDENTIDADE_BLOQUEADA)
      || typeof identidade.transactionId !== 'string'
      || !identidade.transactionId
      || identidade.status !== 'pendente'
      || typeof identidade.financialState !== 'string'
      || !identidade.financialState
      || ['operation_id', 'idempotency_key', 'fingerprint'].some((campo) =>
        identidade[campo] != null && typeof identidade[campo] !== 'string')
      || vistos.has(identidade.transactionId)
      || (anterior != null && anterior.localeCompare(identidade.transactionId) >= 0)) {
      return false;
    }
    vistos.add(identidade.transactionId);
    anterior = identidade.transactionId;
  }
  return true;
}

function validarClaimsBootstrapSeguranca(claims) {
  if (!chaveExata(claims, CAMPOS_BOOTSTRAP)
    || claims.version !== 1
    || claims.protocol !== PROTOCOLO
    || typeof claims.hostSessionId !== 'string'
    || !claims.hostSessionId
    || !/^[a-f0-9]{32}$/i.test(String(claims.bootstrapId || ''))
    || !Number.isSafeInteger(claims.revision)
    || claims.revision < 1
    || !Number.isFinite(claims.issuedAt)
    || Math.abs(Date.now() - claims.issuedAt) > 5 * 60 * 1000
    || claims.recoveryComplete !== true
    || claims.recoveryResult !== 'SUCCESS'
    || !validarIdentidadesBootstrap(claims.blockedIdentities)
    || ![ESTADOS_BOOTSTRAP.VALIDATED, ESTADOS_BOOTSTRAP.BLOCKED].includes(claims.securityState)
    || claims.securityState !== (claims.blockedIdentities.length
      ? ESTADOS_BOOTSTRAP.BLOCKED
      : ESTADOS_BOOTSTRAP.VALIDATED)) {
    return false;
  }

  if (claims.permit == null) return true;
  return chaveExata(claims.permit, CAMPOS_PERMISSAO_BOOTSTRAP)
    && claims.permit.permitId === claims.bootstrapId
    && OPERACOES_TRANSACIONAIS.has(claims.permit.operation)
    && typeof claims.permit.transactionId === 'string'
    && claims.permit.transactionId !== ''
    && !claims.blockedIdentities.some((identidade) =>
      identidade.transactionId === claims.permit.transactionId);
}

function falharContrato(codigo, mensagem) {
  const error = new Error(mensagem);
  error.code = codigo;
  throw error;
}

function assinarEvidencia(claims) {
  if (!validarClaimsEvidencia(claims)) {
    falharContrato(
      'TEF_RECONCILIACAO_EVIDENCIA_INVALIDA',
      'Claims inválidos para assinatura de evidência de reconciliação'
    );
  }
  return {
    claims,
    signature: assinar(serializarClaimsEvidencia(claims))
  };
}

function assinarAutorizacaoReconciliacao(claims) {
  if (!validarClaimsAutorizacaoReconciliacao(claims)) {
    falharContrato(
      'TEF_RECONCILIACAO_AUTORIZACAO_INVALIDA',
      'Claims inválidos para autorização de reconciliação'
    );
  }
  return {
    claims,
    signature: assinar(serializarClaimsAutorizacaoReconciliacao(claims))
  };
}

function assinarBootstrapSeguranca(claims) {
  if (!validarClaimsBootstrapSeguranca(claims)) {
    falharContrato(
      'TEF_RECONCILIACAO_BOOTSTRAP_INVALIDO',
      'Claims inválidos para bootstrap de segurança TEF'
    );
  }
  return {
    claims,
    signature: assinar(serializarClaimsBootstrapSeguranca(claims))
  };
}

function validarEvidencia(evidencia, tipoEsperado, chavePublica) {
  const claims = evidencia?.claims;
  if (!chaveExata(evidencia, ['claims', 'signature'])
    || !validarClaimsEvidencia(claims)
    || claims.eventType !== tipoEsperado
    || typeof evidencia.signature !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(evidencia.signature)) {
    return null;
  }

  try {
    const chavePublicaValidacao = chavePublica == null ? obterChavePublica() : chavePublica;
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(chavePublicaValidacao || ''), 'base64'),
      format: 'der',
      type: 'spki'
    });
    const assinatura = Buffer.from(evidencia.signature, 'base64');
    if (!assinatura.length || assinatura.toString('base64') !== evidencia.signature) return null;
    return crypto.verify(
      null,
      Buffer.from(serializarClaimsEvidencia(claims), 'utf8'),
      publicKey,
      assinatura
    ) ? { ...claims } : null;
  } catch (_) {
    return null;
  }
}

function validarEvidenciaTransacao(evidencia, tipoEsperado, identidade, chavePublica) {
  const claims = validarEvidencia(evidencia, tipoEsperado, chavePublica);
  const identidadeEsperada = {
    transactionId: String(identidade?.transactionId ?? ''),
    operation_id: String(identidade?.operation_id ?? ''),
    idempotency_key: String(identidade?.idempotency_key ?? ''),
    fingerprint: String(identidade?.fingerprint ?? '')
  };
  if (!claims || Object.values(identidadeEsperada).some((valor) => !valor.trim())
    || claims.transacao_id !== identidadeEsperada.transactionId
    || claims.transactionId !== identidadeEsperada.transactionId
    || claims.operation_id !== identidadeEsperada.operation_id
    || claims.idempotency_key !== identidadeEsperada.idempotency_key
    || claims.fingerprint !== identidadeEsperada.fingerprint) {
    return null;
  }
  return claims;
}

function obterChavePublica() {
  return crypto.createPublicKey(derivarChavePrivada())
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
}

module.exports = {
  EVENTO_LIBERACAO,
  EVENTO_COMMIT,
  criarClaimsEvidencia,
  assinarEvidencia,
  assinarAutorizacaoReconciliacao,
  assinarBootstrapSeguranca,
  validarEvidencia,
  validarEvidenciaTransacao,
  obterChavePublica,
  chaveDesenvolvimentoProibida,
};
