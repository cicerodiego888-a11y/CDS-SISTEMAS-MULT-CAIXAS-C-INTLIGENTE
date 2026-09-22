/**
 * Status do ciclo de recuperação de XML (Sprint 2).
 * Independente do DocumentoFiscalStatus do pipeline — refina o diagnóstico.
 *
 * @module motores/central-entradas/recuperacao-xml/StatusRecuperacaoXml
 */
'use strict';

const StatusRecuperacaoXml = Object.freeze({
  RESUMO_RECEBIDO: 'RESUMO_RECEBIDO',
  AGUARDANDO_XML_COMPLETO: 'AGUARDANDO_XML_COMPLETO',
  RECUPERANDO_XML: 'RECUPERANDO_XML',
  XML_COMPLETO: 'XML_COMPLETO',
  XML_INDISPONIVEL: 'XML_INDISPONIVEL',
  RECUPERACAO_ESGOTADA: 'RECUPERACAO_ESGOTADA',
  FORA_JANELA_RECUPERACAO: 'FORA_JANELA_RECUPERACAO',
  ERRO_RECUPERACAO: 'ERRO_RECUPERACAO'
});

const LABELS = Object.freeze({
  [StatusRecuperacaoXml.RESUMO_RECEBIDO]: 'Resumo recebido',
  [StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO]: 'Aguardando XML completo',
  [StatusRecuperacaoXml.RECUPERANDO_XML]: 'Recuperando XML',
  [StatusRecuperacaoXml.XML_COMPLETO]: 'XML completo',
  [StatusRecuperacaoXml.XML_INDISPONIVEL]: 'XML indisponível',
  [StatusRecuperacaoXml.RECUPERACAO_ESGOTADA]: 'Recuperação esgotada',
  [StatusRecuperacaoXml.FORA_JANELA_RECUPERACAO]: 'Fora da janela de recuperação',
  [StatusRecuperacaoXml.ERRO_RECUPERACAO]: 'Erro de recuperação'
});

const PRIORIDADE = Object.freeze({
  ALTA: 'PRIORIDADE_ALTA',
  NORMAL: 'PRIORIDADE_NORMAL',
  BAIXA: 'PRIORIDADE_BAIXA'
});

const PRIORIDADE_PESO = Object.freeze({
  [PRIORIDADE.ALTA]: 1,
  [PRIORIDADE.NORMAL]: 2,
  [PRIORIDADE.BAIXA]: 3
});

function labelStatusRecuperacao(status) {
  const s = String(status || '').toUpperCase();
  return LABELS[s] || s || '—';
}

function logXmlRecovery(payload = {}) {
  const parts = ['[XML-RECOVERY]'];
  if (payload.chave) parts.push(`chave=${payload.chave}`);
  if (payload.status) parts.push(`status=${payload.status}`);
  if (payload.attempt != null) parts.push(`attempt=${payload.attempt}`);
  if (payload.next_attempt) parts.push(`next_attempt=${payload.next_attempt}`);
  if (payload.request) parts.push(`request=${payload.request}`);
  if (payload.cStat) parts.push(`cStat=${payload.cStat}`);
  if (payload.motivo) parts.push(`motivo=${payload.motivo}`);
  console.log(parts.join(' '));
}

module.exports = {
  StatusRecuperacaoXml,
  LABELS,
  PRIORIDADE,
  PRIORIDADE_PESO,
  labelStatusRecuperacao,
  logXmlRecovery
};
