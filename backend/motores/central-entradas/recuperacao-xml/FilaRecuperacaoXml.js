/**
 * FilaRecuperacaoXml — elegibilidade e fila lógica RC3.7.5.
 *
 * Entram: XML_INDISPONIVEL, RESUMO_RECEBIDO (e alias AGUARDANDO_XML_COMPLETO).
 * Não entram: IMPORTADA, CANCELADA, FINALIZADA, DENEGADA, INUTILIZADA (+ demais terminais).
 *
 * @module motores/central-entradas/recuperacao-xml/FilaRecuperacaoXml
 */

'use strict';

const {
  DocumentoFiscalStatus,
  normalizarStatus
} = require('../core/DocumentoFiscalStatus');

const STATUS_MONITORADOS = Object.freeze([
  DocumentoFiscalStatus.XML_INDISPONIVEL,
  DocumentoFiscalStatus.RESUMO_RECEBIDO
]);

const STATUS_EXCLUIDOS = Object.freeze([
  DocumentoFiscalStatus.IMPORTADA,
  DocumentoFiscalStatus.CANCELADA,
  DocumentoFiscalStatus.FINALIZADA,
  DocumentoFiscalStatus.DENEGADA,
  DocumentoFiscalStatus.INUTILIZADA,
  DocumentoFiscalStatus.EM_IMPORTACAO,
  DocumentoFiscalStatus.PRONTA_IMPORTACAO,
  DocumentoFiscalStatus.EM_REVISAO,
  DocumentoFiscalStatus.XML_COMPLETO,
  DocumentoFiscalStatus.NOVA
]);

/**
 * @param {string} status
 * @returns {boolean}
 */
function ehElegivelRecuperacaoXml(status) {
  const st = normalizarStatus(status);
  if (!st) return false;
  if (STATUS_EXCLUIDOS.includes(st)) return false;
  return STATUS_MONITORADOS.includes(st);
}

/**
 * Filtra lista de documentos para a fila de recuperação.
 * @param {Object[]} documentos
 * @returns {Object[]}
 */
function filtrarCandidatosFila(documentos = []) {
  return (documentos || []).filter((doc) => ehElegivelRecuperacaoXml(doc?.status));
}

/**
 * Ordena por prioridade: XML_INDISPONIVEL primeiro, depois mais antigos.
 * @param {Object[]} documentos
 * @returns {Object[]}
 */
function ordenarFila(documentos = []) {
  return [...documentos].sort((a, b) => {
    const sa = normalizarStatus(a.status);
    const sb = normalizarStatus(b.status);
    if (sa === DocumentoFiscalStatus.XML_INDISPONIVEL
      && sb !== DocumentoFiscalStatus.XML_INDISPONIVEL) return -1;
    if (sb === DocumentoFiscalStatus.XML_INDISPONIVEL
      && sa !== DocumentoFiscalStatus.XML_INDISPONIVEL) return 1;
    const ta = new Date(a.createdAt || a.created_at || 0).getTime();
    const tb = new Date(b.createdAt || b.created_at || 0).getTime();
    return ta - tb;
  });
}

module.exports = {
  STATUS_MONITORADOS,
  STATUS_EXCLUIDOS,
  ehElegivelRecuperacaoXml,
  filtrarCandidatosFila,
  ordenarFila
};
