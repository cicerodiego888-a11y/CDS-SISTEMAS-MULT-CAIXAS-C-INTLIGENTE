'use strict';

/**
 * Política única de segurança para resultado financeiro TEF.
 *
 * Esta política NÃO executa retry nem conciliação. Ela apenas classifica
 * resultados e torna explícito que uma autorização financeira nunca deve ser
 * repetida automaticamente após resultado conclusivo ou inconclusivo.
 */

const FINANCIAL_STATES = Object.freeze({
  CONFIRMED_SUCCESS: 'CONFIRMED_SUCCESS',
  CONFIRMED_DENIED: 'CONFIRMED_DENIED',
  PENDING: 'PENDING',
  UNKNOWN: 'UNKNOWN',
  UNCONFIRMED: 'UNCONFIRMED',
  BLOCKED: 'BLOCKED',
  ERROR: 'ERROR'
});

const NO_RETRY_REASONS = Object.freeze({
  SUCCESS: 'TEF_CONFIRMED_SUCCESS_NO_RETRY',
  DENIED: 'TEF_CONFIRMED_DENIED_NO_RETRY',
  ACTION_REQUIRED: 'TEF_ACTION_REQUIRED_NO_RETRY',
  TIMEOUT: 'TEF_TIMEOUT_NO_RETRY',
  UNKNOWN: 'TEF_UNKNOWN_NO_RETRY',
  A0: 'TEF_A0_UNCONFIRMED_NO_RETRY',
  A1: 'TEF_A1_BLOCKED_NO_RETRY',
  NETWORK: 'TEF_NETWORK_UNKNOWN_NO_RETRY'
});

const TRANSPORT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH'
]);

function decisao(financialState, state, retryReason, extra = {}) {
  return {
    financialState,
    state,
    retryAllowed: false,
    retryReason,
    ...extra
  };
}

function classificarCodigoFinanceiro(codigo, estadoProtocolo = null) {
  const code = String(codigo || '').trim().toUpperCase();

  if (code === '00') {
    return decisao(
      FINANCIAL_STATES.CONFIRMED_SUCCESS,
      estadoProtocolo || 'SUCCESS',
      NO_RETRY_REASONS.SUCCESS,
      { resultCode: code }
    );
  }
  if (['03', '04', '09'].includes(code)) {
    return decisao(
      FINANCIAL_STATES.CONFIRMED_DENIED,
      estadoProtocolo || 'DENIED',
      NO_RETRY_REASONS.DENIED,
      { resultCode: code }
    );
  }
  if (code === '99') {
    return decisao(
      FINANCIAL_STATES.PENDING,
      estadoProtocolo || 'WAITING_ACTION',
      NO_RETRY_REASONS.ACTION_REQUIRED,
      { resultCode: code }
    );
  }
  if (code === '08') {
    return decisao(
      FINANCIAL_STATES.UNKNOWN,
      estadoProtocolo || 'TIMEOUT',
      NO_RETRY_REASONS.TIMEOUT,
      { resultCode: code }
    );
  }
  if (code === 'A0') {
    return decisao(
      FINANCIAL_STATES.UNCONFIRMED,
      estadoProtocolo || 'UNCONFIRMED',
      NO_RETRY_REASONS.A0,
      { resultCode: code }
    );
  }
  if (code === 'A1') {
    return decisao(
      FINANCIAL_STATES.BLOCKED,
      estadoProtocolo || 'BLOCKED',
      NO_RETRY_REASONS.A1,
      { resultCode: code }
    );
  }

  return decisao(
    FINANCIAL_STATES.UNKNOWN,
    estadoProtocolo || 'UNKNOWN',
    NO_RETRY_REASONS.UNKNOWN,
    { resultCode: code || null }
  );
}

function obterCodigoTransporte(error) {
  const candidatos = [
    error?.code,
    error?.errno,
    error?.name
  ].map((v) => String(v || '').trim().toUpperCase()).filter(Boolean);

  const encontrado = candidatos.find((codigo) => TRANSPORT_CODES.has(codigo));
  if (encontrado) return encontrado;

  const mensagem = String(error?.message || error || '').toUpperCase();
  return Array.from(TRANSPORT_CODES).find((codigo) => mensagem.includes(codigo)) || null;
}

function classificarErroFinanceiro(error) {
  const mensagem = String(error?.message || error || '');
  const codigoTransporte = obterCodigoTransporte(error);
  const timeout = codigoTransporte === 'ETIMEDOUT' || /TIMEOUT|TEMPO LIMITE/i.test(mensagem);
  const erroRede = Boolean(codigoTransporte)
    || /NETWORK ERROR|SOCKET ERROR|CONNECTION LOST|CONEX[AÃ]O.*(PERDIDA|INTERROMPIDA)|PROCESS.*INTERRUPTED/i.test(mensagem);

  if (timeout) {
    return decisao(
      FINANCIAL_STATES.UNKNOWN,
      'TIMEOUT',
      NO_RETRY_REASONS.TIMEOUT,
      {
        resultCode: codigoTransporte || 'TIMEOUT',
        transportError: true
      }
    );
  }

  if (erroRede) {
    return decisao(
      FINANCIAL_STATES.UNKNOWN,
      'UNKNOWN',
      NO_RETRY_REASONS.NETWORK,
      {
        resultCode: codigoTransporte || 'NETWORK_ERROR',
        transportError: true
      }
    );
  }

  return decisao(
    FINANCIAL_STATES.UNKNOWN,
    'UNKNOWN',
    NO_RETRY_REASONS.UNKNOWN,
    {
      resultCode: error?.code || null,
      transportError: false
    }
  );
}

function classificarResultadoFinanceiro(resultado = {}) {
  const codigo = resultado.codigoDestaxa || resultado.codigo || resultado.resultCode;
  if (codigo) {
    return classificarCodigoFinanceiro(codigo, resultado.estado || resultado.state);
  }

  const status = String(resultado.status || '').toLowerCase();
  if (resultado.sucesso === true || status === 'aprovado') {
    return classificarCodigoFinanceiro('00', 'SUCCESS');
  }
  if (status === 'negado' || status === 'cancelado') {
    return decisao(
      FINANCIAL_STATES.CONFIRMED_DENIED,
      'DENIED',
      NO_RETRY_REASONS.DENIED,
      { resultCode: null }
    );
  }
  if (status === 'pendente') {
    return decisao(
      FINANCIAL_STATES.PENDING,
      'PENDING',
      NO_RETRY_REASONS.UNKNOWN,
      { resultCode: null }
    );
  }
  return decisao(
    FINANCIAL_STATES.UNKNOWN,
    'UNKNOWN',
    NO_RETRY_REASONS.UNKNOWN,
    { resultCode: null }
  );
}

function montarLogDecisao({
  transactionId = null,
  provider = null,
  operation = null,
  decision
} = {}) {
  const d = decision || classificarResultadoFinanceiro({});
  return {
    transactionId: transactionId != null ? String(transactionId) : null,
    provider: provider ? String(provider).toLowerCase() : null,
    operation: operation || null,
    resultCode: d.resultCode || null,
    state: d.state,
    financialState: d.financialState,
    retryAllowed: false,
    retryReason: d.retryReason,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  FINANCIAL_STATES,
  NO_RETRY_REASONS,
  TRANSPORT_CODES,
  classificarCodigoFinanceiro,
  classificarErroFinanceiro,
  classificarResultadoFinanceiro,
  montarLogDecisao
};
