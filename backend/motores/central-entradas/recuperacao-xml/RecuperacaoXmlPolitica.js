/**
 * Política centralizada de recuperação XML (Sprint 2).
 * Sem números mágicos espalhados no motor.
 *
 * @module motores/central-entradas/recuperacao-xml/RecuperacaoXmlPolitica
 */
'use strict';

const { PRIORIDADE } = require('./StatusRecuperacaoXml');

/** Janela operacional DistDFe / distribuição (dias). */
const JANELA_RECUPERACAO_DIAS = 90;

/** Intervalos de backoff entre tentativas (minutos), após a 1ª. */
const BACKOFF_MINUTOS = Object.freeze([60, 120, 360, 720, 1440]);

const ERROS_RECUPERAVEIS = Object.freeze([
  'ERRO_REDE',
  'ERRO_TIMEOUT',
  'ERRO_SEFAZ',
  'ERRO_RATE_LIMIT',
  'ERRO_COOLDOWN',
  'ERRO_CIRCUIT_BREAKER',
  'ERRO_SOAP'
]);

/**
 * @param {number} attemptCount — tentativas já realizadas (0 = ainda não tentou)
 * @param {Date|number} [agora]
 * @param {string|null} [retryAtGate] — ISO do Gate (cooldown/rate)
 * @returns {string} ISO next_attempt_at
 */
function calcularProximaTentativa(attemptCount, agora = new Date(), retryAtGate = null) {
  const base = agora instanceof Date ? agora.getTime() : Number(agora) || Date.now();
  if (retryAtGate) {
    const gateMs = Date.parse(retryAtGate);
    if (Number.isFinite(gateMs) && gateMs > base) {
      return new Date(gateMs).toISOString();
    }
  }
  const idx = Math.min(Math.max(0, Number(attemptCount) || 0), BACKOFF_MINUTOS.length - 1);
  const minutos = BACKOFF_MINUTOS[idx] || BACKOFF_MINUTOS[BACKOFF_MINUTOS.length - 1];
  return new Date(base + minutos * 60 * 1000).toISOString();
}

/**
 * @param {string|null|undefined} dataEmissao
 * @param {Date} [agora]
 * @param {number} [janelaDias]
 * @returns {{ fora: boolean, dias: number|null, dataDocumento: string|null }}
 */
function avaliarJanelaRecuperacao(dataEmissao, agora = new Date(), janelaDias = JANELA_RECUPERACAO_DIAS) {
  if (!dataEmissao) {
    return { fora: false, dias: null, dataDocumento: null };
  }
  const t = new Date(dataEmissao).getTime();
  if (!Number.isFinite(t)) {
    return { fora: false, dias: null, dataDocumento: String(dataEmissao) };
  }
  const dias = (agora.getTime() - t) / (24 * 60 * 60 * 1000);
  return {
    fora: dias > janelaDias,
    dias: Number.isFinite(dias) ? Number(dias.toFixed(1)) : null,
    dataDocumento: new Date(t).toISOString()
  };
}

function erroRecuperavel(codigo) {
  return ERROS_RECUPERAVEIS.includes(String(codigo || '').toUpperCase());
}

function prioridadeDeOrigem(origem) {
  const o = String(origem || '').toUpperCase();
  if (o.includes('MANUAL') || o === 'CONSULTA_MANUAL' || o === 'BAIXAR_XML') {
    return PRIORIDADE.ALTA;
  }
  if (o.includes('AUTO') || o === 'RECUPERACAO_XML' || o === 'SCHEDULER') {
    return PRIORIDADE.NORMAL;
  }
  return PRIORIDADE.NORMAL;
}

module.exports = {
  JANELA_RECUPERACAO_DIAS,
  BACKOFF_MINUTOS,
  ERROS_RECUPERAVEIS,
  calcularProximaTentativa,
  avaliarJanelaRecuperacao,
  erroRecuperavel,
  prioridadeDeOrigem
};
