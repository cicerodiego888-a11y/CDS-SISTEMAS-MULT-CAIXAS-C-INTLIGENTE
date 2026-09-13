/**
 * RC3.6.E — Constantes de resultado da auditoria DF-e.
 * @module services/fiscal/dfeAuditoriaConstantes
 */

'use strict';

const DfeAuditoriaResultado = Object.freeze({
  PROCESSADO: 'PROCESSADO',
  RESUMO: 'RESUMO',
  XML_COMPLETO: 'XML_COMPLETO',
  EVENTO: 'EVENTO',
  DUPLICADO: 'DUPLICADO',
  IGNORADO: 'IGNORADO',
  ERRO_ZIP: 'ERRO_ZIP',
  ERRO_PARSER: 'ERRO_PARSER',
  ERRO_SCHEMA: 'ERRO_SCHEMA',
  ERRO_BANCO: 'ERRO_BANCO',
  SEM_XML: 'SEM_XML',
  SEM_RESUMO: 'SEM_RESUMO',
  DESCONHECIDO: 'DESCONHECIDO',
  CONSULTA: 'CONSULTA',
  NSU_AVANCO: 'NSU_AVANCO',
  NSU_PRESERVADO: 'NSU_PRESERVADO',
  SYNC_RESUMO: 'SYNC_RESUMO'
});

const DfeAuditoriaEtapa = Object.freeze({
  CONSULTA: 'CONSULTA',
  ZIP: 'ZIP',
  PARSER: 'PARSER',
  PERSISTENCIA: 'PERSISTENCIA',
  NSU: 'NSU',
  SYNC: 'SYNC'
});

/**
 * Correlation ID legível para sync DistDFe.
 * Formato: SYNC-YYYYMMDD-HHMMSS-XXX
 * @returns {string}
 */
function criarCorrelationIdDfeSync() {
  const d = new Date();
  const p = (n, s = 2) => String(n).padStart(s, '0');
  const stamp = [
    d.getFullYear(),
    p(d.getMonth() + 1),
    p(d.getDate()),
    '-',
    p(d.getHours()),
    p(d.getMinutes()),
    p(d.getSeconds())
  ].join('');
  const seq = p(Math.floor(Math.random() * 1000), 3);
  return `SYNC-${stamp}-${seq}`;
}

module.exports = {
  DfeAuditoriaResultado,
  DfeAuditoriaEtapa,
  criarCorrelationIdDfeSync
};
