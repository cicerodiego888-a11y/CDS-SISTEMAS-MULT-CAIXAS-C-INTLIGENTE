/**
 * Descoberta distNSU / auditoria de cursor (Sprint 3).
 * Camada independente de: Gate (proteção) e recuperação XML (Sprint 2).
 */
'use strict';

const DistNsuFluxoMapa = require('./DistNsuFluxoMapa');
const DistNsuStatus = require('./DistNsuStatus');
const DistNsuCursorPolitica = require('./DistNsuCursorPolitica');
const NsuLacunaDetector = require('./NsuLacunaDetector');
const DistNsuSyncLock = require('./DistNsuSyncLock');
const CentralDistNsuDiagnosticoService = require('./CentralDistNsuDiagnosticoService');

module.exports = {
  ...DistNsuFluxoMapa,
  ...DistNsuStatus,
  ...DistNsuCursorPolitica,
  ...NsuLacunaDetector,
  DistNsuSyncLock,
  obterDistNsuSyncLock: DistNsuSyncLock.obterDistNsuSyncLock,
  CentralDistNsuDiagnosticoService
};
