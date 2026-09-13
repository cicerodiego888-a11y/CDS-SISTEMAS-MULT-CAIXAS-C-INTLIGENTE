/**
 * Sprint 14.2 — Fingerprint Engine V1.0
 */

'use strict';

const fingerprintService = require('./FingerprintService');
const ProtocolDetector = require('./ProtocolDetector');
const DriverResolver = require('./DriverResolver');
const FingerprintRepository = require('./FingerprintRepository');
const FingerprintCandidate = require('./FingerprintCandidate');

module.exports = {
  FingerprintService: fingerprintService.FingerprintService,
  fingerprintService,
  ProtocolDetector,
  DriverResolver,
  FingerprintRepository,
  FingerprintCandidate,
  identificar: (candidate, opcoes) => fingerprintService.identificar(candidate, opcoes)
};
