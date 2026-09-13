'use strict';

const { classificarRetornoSefaz, ACOES } = require('./classificarRetornoSefaz');

const ESTADOS = Object.freeze({
  RASCUNHO: 'rascunho',
  PREPARANDO_XML: 'preparando_xml',
  VALIDADA_LOCALMENTE: 'validada_localmente',
  ASSINANDO: 'assinando',
  ASSINADA: 'assinada',
  VALIDANDO: 'validando',
  ENVIANDO: 'enviando',
  TRANSMITINDO: 'enviando',
  LOTE_ENVIADO: 'lote_enviado',
  PROCESSANDO: 'aguardando_retorno',
  PROCESSANDO_RETORNO: 'aguardando_retorno',
  AUTORIZADA: 'autorizada',
  CANCELADA: 'cancelada',
  REJEITADA: 'rejeitada',
  DENEGADA: 'denegada',
  CONFLITO_IDENTIDADE: 'conflito_identidade',
  CANCELAMENTO_REJEITADO: 'cancelamento_rejeitado',
  ERRO_COMUNICACAO: 'erro_comunicacao',
  ERRO_ASSINATURA: 'erro_assinatura',
  ERRO_VALIDACAO: 'erro_validacao',
  ERRO_TECNICO: 'erro_comunicacao',
  PENDENTE_REENVIO: 'pendente_reenvio'
});

const ESTADOS_UI = Object.freeze({
  [ESTADOS.RASCUNHO]: { label: 'Rascunho', cor: 'cinza', emoji: '⚪' },
  [ESTADOS.PREPARANDO_XML]: { label: 'Preparando XML', cor: 'azul', emoji: '🔵' },
  [ESTADOS.VALIDADA_LOCALMENTE]: { label: 'Validada localmente', cor: 'azul', emoji: '🔵' },
  [ESTADOS.ASSINANDO]: { label: 'Assinando', cor: 'azul', emoji: '🔵' },
  [ESTADOS.ASSINADA]: { label: 'Assinada', cor: 'azul', emoji: '🔵' },
  [ESTADOS.VALIDANDO]: { label: 'Validando', cor: 'azul', emoji: '🔵' },
  [ESTADOS.ENVIANDO]: { label: 'Enviando', cor: 'azul', emoji: '🔵' },
  [ESTADOS.LOTE_ENVIADO]: { label: 'Lote enviado', cor: 'amarelo', emoji: '🟡' },
  [ESTADOS.PROCESSANDO]: { label: 'Processando', cor: 'amarelo', emoji: '🟡' },
  [ESTADOS.AUTORIZADA]: { label: 'Autorizada', cor: 'verde', emoji: '🟢' },
  [ESTADOS.CANCELADA]: { label: 'Cancelada', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.REJEITADA]: { label: 'Rejeitada', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.DENEGADA]: { label: 'Denegada', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.CONFLITO_IDENTIDADE]: { label: 'Conflito de identidade', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.ERRO_COMUNICACAO]: { label: 'Erro comunicação', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.ERRO_ASSINATURA]: { label: 'Erro assinatura', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.ERRO_VALIDACAO]: { label: 'Erro validação', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.CANCELAMENTO_REJEITADO]: { label: 'Cancelamento rejeitado', cor: 'vermelho', emoji: '🔴' },
  [ESTADOS.PENDENTE_REENVIO]: { label: 'Pendente reenvio', cor: 'amarelo', emoji: '🟡' }
});

const REENVIAVEL = new Set([
  ESTADOS.REJEITADA,
  ESTADOS.ERRO_COMUNICACAO,
  ESTADOS.ERRO_VALIDACAO,
  ESTADOS.ERRO_ASSINATURA,
  ESTADOS.PENDENTE_REENVIO,
  'erro_transmissao',
  'timeout',
  'servico_indisponivel'
]);

const BLOQUEIO_REENVIO = new Set([
  ESTADOS.AUTORIZADA,
  ESTADOS.CANCELADA,
  ESTADOS.DENEGADA,
  ESTADOS.PROCESSANDO,
  ESTADOS.LOTE_ENVIADO,
  ESTADOS.ENVIANDO,
  ESTADOS.ASSINADA,
  ESTADOS.CONFLITO_IDENTIDADE
]);

/** cStat cujo XML é inválido: reenviar o mesmo arquivo só repete a rejeição. */
const CSTAT_XML_INVALIDO_DEFINITIVO = new Set(['275', '539', '590', '591', '863']);

const EVENTOS = Object.freeze({
  XML_GERADO: 'xml_gerado',
  ASSINADO: 'assinado',
  VALIDADO: 'validado',
  ENVIADO: 'enviado',
  LOTE_RECEBIDO: 'lote_recebido',
  CONSULTA: 'consulta',
  CONSULTA_AUTOMATICA: 'consulta_automatica',
  AUTORIZADO: 'autorizado',
  REJEITADO: 'rejeitado',
  DENEGADO: 'denegado',
  DANFE_GERADO: 'danfe_gerado',
  CANCELADO: 'cancelado',
  CANCELAMENTO_REJEITADO: 'cancelamento_rejeitado',
  REENVIO: 'reenvio',
  ERRO: 'erro'
});

function uiDoEstado(status) {
  const st = String(status || '').toLowerCase();
  return ESTADOS_UI[st] || { label: status || 'Desconhecido', cor: 'cinza', emoji: '⚪' };
}

function codigoRejeicaoNota(nota = {}) {
  return String(nota.cstat_retorno || nota.rejeicao_codigo || nota.cStat || '')
    .replace(/\D/g, '');
}

function xmlRejeicaoFiscalDefinitiva(nota = {}) {
  const cls = classificarRetornoSefaz(codigoRejeicaoNota(nota));
  return [
    ACOES.EXIGE_CORRECAO,
    ACOES.EXIGE_NOVA_IDENTIDADE,
    ACOES.SINCRONIZAR_DOCUMENTO_EXISTENTE
  ].includes(cls.acao);
}

function podeReenviarDevolucao(nota = {}) {
  const st = String(nota.status || '').toLowerCase();
  if (BLOQUEIO_REENVIO.has(st)) return false;
  if (xmlRejeicaoFiscalDefinitiva(nota)) return false;
  const cls = classificarRetornoSefaz(codigoRejeicaoNota(nota));
  if (cls.acao === ACOES.REENVIAVEL) return true;
  if (REENVIAVEL.has(st) && !cls.cStat) return true;
  return false;
}

function podeCancelarDevolucao({ status } = {}) {
  const st = String(status || '').toLowerCase();
  return st === ESTADOS.AUTORIZADA || st === ESTADOS.CANCELAMENTO_REJEITADO;
}

function mensagemReenvioXmlEstruturalmenteRejeitado(nota = {}) {
  const cls = classificarRetornoSefaz(codigoRejeicaoNota(nota));
  if (cls.mensagemReenvio) return cls.mensagemReenvio;
  const cStat = codigoRejeicaoNota(nota) || '—';
  return (
    'Esta NF-e possui XML rejeitado por inconsistência fiscal.\n\n'
    + `cStat: ${cStat}\n\n`
    + 'O XML original não pode ser reutilizado.\n\n'
    + 'É necessário gerar uma nova emissão utilizando as regras fiscais atuais.'
  );
}

function podeGerarNovaIdentidadeDevolucao(nota = {}) {
  return xmlRejeicaoFiscalDefinitiva(nota);
}

function mensagemNovaIdentidadeDevolucao(nota = {}) {
  const cls = classificarRetornoSefaz(codigoRejeicaoNota(nota));
  if (cls.acao === ACOES.EXIGE_NOVA_IDENTIDADE) {
    return (
      'Esta NF-e possui uma identidade fiscal que conflita com um documento já existente na SEFAZ.\n\n'
      + 'Os dados da devolução foram preservados.\n\n'
      + 'Para continuar, gere uma nova NF-e com nova numeração fiscal.'
    );
  }
  return mensagemReenvioXmlEstruturalmenteRejeitado(nota);
}

function mensagemRejeicaoDetalhada(cStat, xMotivo) {
  const codigo = String(cStat || '').trim();
  const motivo = String(xMotivo || '').trim() || 'Motivo não informado pela SEFAZ';
  if (!codigo) return motivo;
  return `Rejeição ${codigo}\n${motivo}`;
}

module.exports = {
  ESTADOS,
  ESTADOS_UI,
  EVENTOS,
  REENVIAVEL,
  BLOQUEIO_REENVIO,
  CSTAT_XML_INVALIDO_DEFINITIVO,
  ACOES,
  uiDoEstado,
  codigoRejeicaoNota,
  xmlRejeicaoFiscalDefinitiva,
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  mensagemRejeicaoDetalhada,
  mensagemReenvioXmlEstruturalmenteRejeitado,
  podeGerarNovaIdentidadeDevolucao,
  mensagemNovaIdentidadeDevolucao
};
