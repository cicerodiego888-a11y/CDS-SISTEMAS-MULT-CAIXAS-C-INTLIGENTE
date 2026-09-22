/**
 * FilaRecuperacaoXml — elegibilidade e fila lógica RC3.7.5 + Sprint 2.
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
const { PRIORIDADE, PRIORIDADE_PESO } = require('./StatusRecuperacaoXml');

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
  DocumentoFiscalStatus.NOVA,
  DocumentoFiscalStatus.RECUPERACAO_ESGOTADA,
  DocumentoFiscalStatus.FORA_JANELA_RECUPERACAO
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
 * Identidade operacional: CNPJ + ambiente + chave.
 * @param {Object} doc
 * @param {number} [ambiente]
 * @returns {string}
 */
function chaveIdentidadeRecuperacao(doc = {}, ambiente = 1) {
  const cnpj = String(doc.cnpjEmpresa || doc.cnpj_empresa || doc.cnpjDestinatario || '')
    .replace(/\D/g, '');
  const chave = String(doc.chave || '').replace(/\D/g, '');
  const amb = Number(ambiente) === 1 ? 1 : 2;
  return `${cnpj}|${amb}|${chave}`;
}

/**
 * Ordena: prioridade ALTA → NORMAL → BAIXA; XML_INDISPONIVEL; mais antigos.
 * @param {Object[]} documentos
 * @returns {Object[]}
 */
function ordenarFila(documentos = []) {
  return [...documentos].sort((a, b) => {
    const pa = PRIORIDADE_PESO[a.recuperacaoPrioridade || a.prioridade || PRIORIDADE.NORMAL]
      || PRIORIDADE_PESO[PRIORIDADE.NORMAL];
    const pb = PRIORIDADE_PESO[b.recuperacaoPrioridade || b.prioridade || PRIORIDADE.NORMAL]
      || PRIORIDADE_PESO[PRIORIDADE.NORMAL];
    if (pa !== pb) return pa - pb;

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

/**
 * Deduplica por chave NFe (mantém o primeiro após ordenação).
 * @param {Object[]} documentos
 * @returns {Object[]}
 */
function deduplicarPorChave(documentos = []) {
  const visto = new Set();
  const out = [];
  for (const doc of documentos) {
    const chave = String(doc.chave || '').replace(/\D/g, '');
    if (!chave) {
      out.push(doc);
      continue;
    }
    if (visto.has(chave)) continue;
    visto.add(chave);
    out.push(doc);
  }
  return out;
}

module.exports = {
  STATUS_MONITORADOS,
  STATUS_EXCLUIDOS,
  ehElegivelRecuperacaoXml,
  filtrarCandidatosFila,
  ordenarFila,
  chaveIdentidadeRecuperacao,
  deduplicarPorChave
};
