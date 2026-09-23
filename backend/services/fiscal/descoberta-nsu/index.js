/**
 * Descoberta / Reconciliação DF-e (Sprint 4 + classificação NSU Sprint 6).
 * Camada somente diagnóstico — sem SEFAZ e sem alteração de cursor.
 */
'use strict';

const ReconcilicaoDfeStatus = require('./ReconcilicaoDfeStatus');
const ReconcilicaoDfeAchados = require('./ReconcilicaoDfeAchados');
const ReconcilicaoDfeId = require('./ReconcilicaoDfeId');
const ReconcilicaoDfeSnapshotStore = require('./ReconcilicaoDfeSnapshotStore');
const MotorReconcilicaoDfe = require('./MotorReconcilicaoDfe');
const NsuFonteClassificacao = require('./NsuFonteClassificacao');

module.exports = {
  ...ReconcilicaoDfeStatus,
  ...ReconcilicaoDfeAchados,
  ...ReconcilicaoDfeId,
  ...NsuFonteClassificacao,
  ReconcilicaoDfeSnapshotStore,
  obterSnapshotStore: ReconcilicaoDfeSnapshotStore.obterSnapshotStore,
  MotorReconcilicaoDfe
};
