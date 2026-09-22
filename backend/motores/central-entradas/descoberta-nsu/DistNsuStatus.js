/**
 * Status operacional da descoberta distNSU (Sprint 3).
 * @module motores/central-entradas/descoberta-nsu/DistNsuStatus
 */
'use strict';

const DistNsuStatus = Object.freeze({
  SINCRONIZANDO: 'SINCRONIZANDO',
  AGUARDANDO: 'AGUARDANDO',
  SEM_NOVOS_DOCUMENTOS: 'SEM_NOVOS_DOCUMENTOS',
  BLOQUEADO: 'BLOQUEADO',
  ERRO: 'ERRO',
  LOTE_PROCESSADO: 'LOTE_PROCESSADO',
  CURSOR_PRESERVADO: 'CURSOR_PRESERVADO',
  LACUNA_DETECTADA: 'LACUNA_DETECTADA',
  POSSIVEL_LACUNA_NSU: 'POSSIVEL_LACUNA_NSU',
  DOCUMENTO_DUPLICADO_RECEBIDO: 'DOCUMENTO_DUPLICADO_RECEBIDO',
  ERRO_PARSER: 'ERRO_PARSER',
  ERRO_BANCO: 'ERRO_BANCO',
  DOCUMENTOS_POSTERIORES: 'DOCUMENTOS_POSTERIORES'
});

const LABELS = Object.freeze({
  [DistNsuStatus.SINCRONIZANDO]: 'Sincronizando',
  [DistNsuStatus.AGUARDANDO]: 'Aguardando',
  [DistNsuStatus.SEM_NOVOS_DOCUMENTOS]: 'Sem novos documentos',
  [DistNsuStatus.BLOQUEADO]: 'Bloqueado',
  [DistNsuStatus.ERRO]: 'Erro',
  [DistNsuStatus.LOTE_PROCESSADO]: 'Lote processado',
  [DistNsuStatus.CURSOR_PRESERVADO]: 'Cursor preservado',
  [DistNsuStatus.LACUNA_DETECTADA]: 'Lacuna detectada',
  [DistNsuStatus.POSSIVEL_LACUNA_NSU]: 'Possível lacuna de NSU',
  [DistNsuStatus.DOCUMENTO_DUPLICADO_RECEBIDO]: 'Documento duplicado recebido',
  [DistNsuStatus.ERRO_PARSER]: 'Erro de parser',
  [DistNsuStatus.ERRO_BANCO]: 'Erro de banco',
  [DistNsuStatus.DOCUMENTOS_POSTERIORES]: 'Documentos posteriores disponíveis'
});

function labelDistNsuStatus(status) {
  const s = String(status || '').toUpperCase();
  return LABELS[s] || s || '—';
}

module.exports = {
  DistNsuStatus,
  LABELS,
  labelDistNsuStatus
};
