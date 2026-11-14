/**
 * MUC RC1 — Tipos oficiais de apresentação comercial (ProdutoApresentacao)
 * Tabela física: produto_embalagens (compatibilidade retroativa)
 * @module motores/muc/constants/tiposApresentacao
 */
'use strict';

const TIPOS_APRESENTACAO = Object.freeze([
  'UN', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'MM',
  'CX', 'FD', 'PCT', 'DISPLAY', 'KIT', 'SACO', 'ROLO', 'BOBINA', 'GALAO', 'BALDE', 'VARA', 'SERVICO'
]);

const LABELS_APRESENTACAO = Object.freeze({
  UN: 'Unidade', KG: 'Quilograma', G: 'Grama', L: 'Litro', ML: 'Mililitro',
  M: 'Metro', CM: 'Centímetro', MM: 'Milímetro',
  CX: 'Caixa', FD: 'Fardo', PCT: 'Pacote', DISPLAY: 'Display', KIT: 'Kit',
  SACO: 'Saco', ROLO: 'Rolo', BOBINA: 'Bobina', GALAO: 'Galão', BALDE: 'Balde', VARA: 'Vara',
  SERVICO: 'Serviço'
});

const MAPA_TIPO_PARA_UNIDADE_COMERCIAL = Object.freeze({
  UN: 'UN', KG: 'KG', G: 'G', L: 'L', ML: 'ML', M: 'M', CM: 'CM', MM: 'CM',
  CX: 'CAIXA', FD: 'FARDO', PCT: 'PACOTE', KIT: 'PACOTE', DISPLAY: 'PACOTE',
  SACO: 'SACO', ROLO: 'ROLO', BOBINA: 'ROLO', BALDE: 'BALDE', GALAO: 'BALDE', VARA: 'VARA',
  SERVICO: 'UN'
});

const MAPA_UNIDADE_COMERCIAL_PARA_TIPO = Object.freeze({
  UN: 'UN', UND: 'UN', KG: 'KG', G: 'G', L: 'L', LT: 'L', ML: 'ML',
  M: 'M', MT: 'M', CM: 'CM', MM: 'MM',
  CAIXA: 'CX', CX: 'CX', FARDO: 'FD', FD: 'FD', PACOTE: 'PCT', PCT: 'PCT',
  KIT: 'KIT', DISPLAY: 'DISPLAY', SACO: 'SACO', ROLO: 'ROLO', BOBINA: 'BOBINA',
  BALDE: 'BALDE', GALAO: 'GALAO', GALÃO: 'GALAO', VARA: 'VARA', SERVICO: 'SERVICO', SERVIÇO: 'SERVICO'
});

/**
 * Tipo oficial, alias legado ou identificador personalizado (letra inicial, até 16 caracteres).
 * Identificador inválido não é aceito e não vira outro tipo.
 */
function classificarTipoApresentacao(valor) {
  const raw = String(valor ?? '').trim().toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (!raw) return { tipo: 'UN', aceito: true, personalizado: false };
  if (TIPOS_APRESENTACAO.includes(raw)) return { tipo: raw, aceito: true, personalizado: false };
  if (MAPA_UNIDADE_COMERCIAL_PARA_TIPO[raw]) {
    return { tipo: MAPA_UNIDADE_COMERCIAL_PARA_TIPO[raw], aceito: true, personalizado: false };
  }
  if (/^[A-Z][A-Z0-9]{0,15}$/.test(raw)) {
    return { tipo: raw, aceito: true, personalizado: true };
  }
  return { tipo: raw, aceito: false, personalizado: false };
}

function normalizarTipoApresentacao(valor) {
  const classe = classificarTipoApresentacao(valor);
  return classe.aceito ? classe.tipo : 'UN';
}

function tipoParaUnidadeComercial(tipo) {
  const normalizado = normalizarTipoApresentacao(tipo);
  return MAPA_TIPO_PARA_UNIDADE_COMERCIAL[normalizado] || normalizado || 'UN';
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
  classificarTipoApresentacao,
  normalizarTipoApresentacao,
  tipoParaUnidadeComercial,
  unidadeComercialParaTipo,
  labelApresentacao
};
