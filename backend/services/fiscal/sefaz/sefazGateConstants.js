/**
 * Constantes do SEFAZ Query Gate (Sprint 1).
 * Políticas centralizadas — sem números mágicos espalhados.
 */
'use strict';

const TIPOS_CONSULTA = Object.freeze({
  DIST_NSU: 'DIST_NSU',
  CONS_NSU: 'CONS_NSU',
  CONS_CH_NFE: 'CONS_CH_NFE'
});

const ORIGENS = Object.freeze({
  CENTRAL_SYNC: 'CENTRAL_SYNC',
  RECUPERACAO_XML: 'RECUPERACAO_XML',
  MANIFESTACAO: 'MANIFESTACAO',
  CONSULTA_MANUAL: 'CONSULTA_MANUAL',
  DIAGNOSTICO: 'DIAGNOSTICO',
  MIRX: 'MIRX',
  DESCONHECIDO: 'DESCONHECIDO'
});

const ESTADOS_SOLICITACAO = Object.freeze({
  QUEUED: 'QUEUED',
  AUTHORIZED: 'AUTHORIZED',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  WAITING: 'WAITING',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED'
});

const CIRCUIT_STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
});

const ERROS = Object.freeze({
  ERRO_SEFAZ: 'ERRO_SEFAZ',
  ERRO_REDE: 'ERRO_REDE',
  ERRO_CERTIFICADO: 'ERRO_CERTIFICADO',
  ERRO_XML: 'ERRO_XML',
  ERRO_TIMEOUT: 'ERRO_TIMEOUT',
  ERRO_RATE_LIMIT: 'ERRO_RATE_LIMIT',
  ERRO_COOLDOWN: 'ERRO_COOLDOWN',
  ERRO_CIRCUIT_BREAKER: 'ERRO_CIRCUIT_BREAKER',
  ERRO_NSU_REGRESSAO: 'ERRO_NSU_REGRESSAO',
  ERRO_CONCORRENCIA: 'ERRO_CONCORRENCIA'
});

/** Intervalo mínimo entre consultas autorizadas (mesmo CNPJ+ambiente+tipo). */
const RATE_LIMIT_MIN_INTERVAL_MS = 1500;

/** Cooldown padrão após cStat 137 (fila esgotada / sem documentos). */
const COOLDOWN_137_MS = 60 * 60 * 1000;

/** Cooldown padrão após cStat 656 (consumo indevido). */
const COOLDOWN_656_MS = 60 * 60 * 1000;

/** Tempo em OPEN antes de tentar HALF_OPEN. */
const CIRCUIT_OPEN_MS = 60 * 60 * 1000;

/** Histórico de auditoria em memória. */
const AUDIT_MAX = 200;

function normalizarCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function normalizarAmbiente(ambiente) {
  const n = Number(ambiente);
  return n === 1 ? 1 : 2;
}

function chaveIdentidade(cnpj, ambiente) {
  return `${normalizarCnpj(cnpj)}|${normalizarAmbiente(ambiente)}`;
}

function inferirTipoDoXml(xmlConsulta) {
  const xml = String(xmlConsulta || '');
  if (/<consChNFe[\s>]/i.test(xml)) return TIPOS_CONSULTA.CONS_CH_NFE;
  if (/<consNSU[\s>]/i.test(xml)) return TIPOS_CONSULTA.CONS_NSU;
  if (/<distNSU[\s>]/i.test(xml)) return TIPOS_CONSULTA.DIST_NSU;
  return TIPOS_CONSULTA.DIST_NSU;
}

function extrairUltNsuDoXml(xmlConsulta) {
  const m = String(xmlConsulta || '').match(/<ultNSU>\s*([^<]+)\s*<\/ultNSU>/i);
  return m ? String(m[1]).trim() : null;
}

function extrairChaveDoXml(xmlConsulta) {
  const m = String(xmlConsulta || '').match(/<chNFe>\s*([^<]+)\s*<\/chNFe>/i);
  return m ? String(m[1]).replace(/\D/g, '') : null;
}

module.exports = {
  TIPOS_CONSULTA,
  ORIGENS,
  ESTADOS_SOLICITACAO,
  CIRCUIT_STATE,
  ERROS,
  RATE_LIMIT_MIN_INTERVAL_MS,
  COOLDOWN_137_MS,
  COOLDOWN_656_MS,
  CIRCUIT_OPEN_MS,
  AUDIT_MAX,
  normalizarCnpj,
  normalizarAmbiente,
  chaveIdentidade,
  inferirTipoDoXml,
  extrairUltNsuDoXml,
  extrairChaveDoXml
};
