/**
 * Descoberta / Reconciliação DF-e (Sprint 4).
 * Camada somente diagnóstico — sem SEFAZ e sem alteração de cursor.
 */
'use strict';

const ReconcilicaoDfeStatus = require('./ReconcilicaoDfeStatus');
const ReconcilicaoDfeAchados = require('./ReconcilicaoDfeAchados');
const ReconcilicaoDfeId = require('./ReconcilicaoDfeId');
const ReconcilicaoDfeSnapshotStore = require('./ReconcilicaoDfeSnapshotStore');
const MotorReconcilicaoDfe = require('./MotorReconcilicaoDfe');

module.exports = {
  ...ReconcilicaoDfeStatus,
  ...ReconcilicaoDfeAchados,
  ...ReconcilicaoDfeId,
  ReconcilicaoDfeSnapshotStore,
  obterSnapshotStore: ReconcilicaoDfeSnapshotStore.obterSnapshotStore,
  MotorReconcilicaoDfe
};
