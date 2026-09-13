/**
 * MUC RC1 — Tipos oficiais de apresentação comercial (ProdutoApresentacao)
 * Tabela física: produto_embalagens (compatibilidade retroativa)
 * @module motores/muc/constants/tiposApresentacao
 */
'use strict';

const TIPOS_APRESENTACAO = Object.freeze([
  'UN', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'MM',
  'CX', 'FD', 'PCT', 'DISPLAY', 'KIT', 'SACO', 'ROLO', 'BOBINA', 'GALAO', 'BALDE', 'SERVICO'
]);

const LABELS_APRESENTACAO = Object.freeze({
  UN: 'Unidade', KG: 'Quilograma', G: 'Grama', L: 'Litro', ML: 'Mililitro',
  M: 'Metro', CM: 'Centímetro', MM: 'Milímetro',
  CX: 'Caixa', FD: 'Fardo', PCT: 'Pacote', DISPLAY: 'Display', KIT: 'Kit',
  SACO: 'Saco', ROLO: 'Rolo', BOBINA: 'Bobina', GALAO: 'Galão', BALDE: 'Balde',
  SERVICO: 'Serviço'
});

const MAPA_TIPO_PARA_UNIDADE_COMERCIAL = Object.freeze({
  UN: 'UN', KG: 'KG', G: 'G', L: 'L', ML: 'ML', M: 'M', CM: 'CM', MM: 'CM',
  CX: 'CAIXA', FD: 'FARDO', PCT: 'PACOTE', KIT: 'PACOTE', DISPLAY: 'PACOTE',
  SACO: 'SACO', ROLO: 'ROLO', BOBINA: 'ROLO', BALDE: 'BALDE', GALAO: 'BALDE',
  SERVICO: 'UN'
});

const MAPA_UNIDADE_COMERCIAL_PARA_TIPO = Object.freeze({
  UN: 'UN', UND: 'UN', KG: 'KG', G: 'G', L: 'L', LT: 'L', ML: 'ML',
  M: 'M', MT: 'M', CM: 'CM', MM: 'MM',
  CAIXA: 'CX', CX: 'CX', FARDO: 'FD', FD: 'FD', PACOTE: 'PCT', PCT: 'PCT',
  KIT: 'KIT', DISPLAY: 'DISPLAY', SACO: 'SACO', ROLO: 'ROLO', BOBINA: 'BOBINA',
  BALDE: 'BALDE', GALAO: 'GALAO', GALÃO: 'GALAO', SERVICO: 'SERVICO', SERVIÇO: 'SERVICO'
});

function normalizarTipoApresentacao(valor) {
  const raw = String(valor || 'UN').trim().toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (TIPOS_APRESENTACAO.includes(raw)) return raw;
  if (MAPA_UNIDADE_COMERCIAL_PARA_TIPO[raw]) return MAPA_UNIDADE_COMERCIAL_PARA_TIPO[raw];
  return 'UN';
}

function tipoParaUnidadeComercial(tipo) {
  return MAPA_TIPO_PARA_UNIDADE_COMERCIAL[normalizarTipoApresentacao(tipo)] || 'UN';
}

/** Inverso de tipoParaUnidadeComercial — ex.: CAIXA → CX, PACOTE → PCT */
function unidadeComercialParaTipo(unidadeComercial) {
  return normalizarTipoApresentacao(unidadeComercial);
}

function labelApresentacao(tipo) {
  return LABELS_APRESENTACAO[normalizarTipoApresentacao(tipo)] || tipo;
}

module.exports = {
  TIPOS_APRESENTACAO,
  LABELS_APRESENTACAO,
  MAPA_TIPO_PARA_UNIDADE_COMERCIAL,
  MAPA_UNIDADE_COMERCIAL_PARA_TIPO,
  normalizarTipoApresentacao,
  tipoParaUnidadeComercial,
  unidadeComercialParaTipo,
  labelApresentacao
};
