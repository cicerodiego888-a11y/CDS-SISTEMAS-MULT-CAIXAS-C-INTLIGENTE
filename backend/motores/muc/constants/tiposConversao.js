/**
 * MUC RC1 — Tipos oficiais de conversão
 * @module motores/muc/constants/tiposConversao
 */
'use strict';

const TIPOS_CONVERSAO = Object.freeze([
  'UNIDADE',
  'MULTIPLICADOR',
  'DIVISOR',
  'PESO',
  'VOLUME',
  'LINEAR',
  'KIT',
  'PERSONALIZADO'
]);

const LABELS_TIPO_CONVERSAO = Object.freeze({
  UNIDADE: 'Unidade',
  MULTIPLICADOR: 'Multiplicador',
  DIVISOR: 'Divisor',
  PESO: 'Peso',
  VOLUME: 'Volume',
  LINEAR: 'Linear',
  KIT: 'Kit',
  PERSONALIZADO: 'Personalizado'
});

function normalizarTipoConversao(valor) {
  const raw = String(valor || 'UNIDADE').trim().toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return TIPOS_CONVERSAO.includes(raw) ? raw : 'UNIDADE';
}

/** Inferência heurística tipo apresentação + unidade base → tipo_conversao */
function inferirTipoConversao(tipoApresentacao, unidadeBase) {
  const tipo = String(tipoApresentacao || 'UN').toUpperCase();
  const un = String(unidadeBase || 'un').toLowerCase();

  if (['kg', 'g'].includes(un)) return 'PESO';
  if (['l', 'ml', 'lt'].includes(un)) return 'VOLUME';
  if (['mt', 'm', 'cm', 'mm'].includes(un)) return 'LINEAR';

  if (tipo === 'KIT') return 'KIT';
  if (tipo === 'SACO') return 'PESO';
  if (['ROLO', 'BOBINA'].includes(tipo)) return 'LINEAR';
  if (['CX', 'FD', 'PCT', 'DISPLAY', 'BALDE', 'GALAO'].includes(tipo)) return 'MULTIPLICADOR';
  if (tipo === 'UN' || tipo === 'SERVICO') return 'UNIDADE';

  return 'PERSONALIZADO';
}

module.exports = {
  TIPOS_CONVERSAO,
  LABELS_TIPO_CONVERSAO,
  normalizarTipoConversao,
  inferirTipoConversao
};
