/**
 * Status geral da reconciliação DF-e (Sprint 4).
 * @module services/fiscal/descoberta-nsu/ReconcilicaoDfeStatus
 */
'use strict';

const ReconcilicaoStatus = Object.freeze({
  CONSISTENTE: 'CONSISTENTE',
  ATENCAO: 'ATENCAO',
  INCONSISTENTE: 'INCONSISTENTE',
  ERRO_ANALISE: 'ERRO_ANALISE'
});

const LABELS = Object.freeze({
  [ReconcilicaoStatus.CONSISTENTE]: 'Consistente',
  [ReconcilicaoStatus.ATENCAO]: 'Atenção',
  [ReconcilicaoStatus.INCONSISTENTE]: 'Inconsistente',
  [ReconcilicaoStatus.ERRO_ANALISE]: 'Erro na análise'
});

const SEVERIDADE = Object.freeze({
  [ReconcilicaoStatus.CONSISTENTE]: 'verde',
  [ReconcilicaoStatus.ATENCAO]: 'amarelo',
  [ReconcilicaoStatus.INCONSISTENTE]: 'vermelho',
  [ReconcilicaoStatus.ERRO_ANALISE]: 'vermelho'
});

function labelReconcilicaoStatus(status) {
  const s = String(status || '').toUpperCase();
  return LABELS[s] || s || '—';
}

module.exports = {
  ReconcilicaoStatus,
  LABELS,
  SEVERIDADE,
  labelReconcilicaoStatus
};
