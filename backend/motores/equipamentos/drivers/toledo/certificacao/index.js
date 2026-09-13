/**
 * Sprint 14.12 — Certificação e Homologação V2.0
 */

'use strict';

const ToledoVersion = require('./ToledoVersion');
const ToledoDiagnostics = require('./ToledoDiagnostics');
const ArchitectureAuditor = require('./ArchitectureAuditor');
const HomologacaoChecklist = require('./HomologacaoChecklist');
const CertificationReport = require('./CertificationReport');
const DiagnosticsController = require('./DiagnosticsController');

module.exports = {
  ToledoVersion,
  ToledoDiagnostics,
  ArchitectureAuditor,
  HomologacaoChecklist,
  CertificationReport,
  DiagnosticsController,
  getVersion: ToledoVersion.getVersion,
  health: ToledoDiagnostics.health,
  diagnostics: ToledoDiagnostics.diagnostics,
  auditArchitecture: ArchitectureAuditor.auditArchitecture,
  buildCertificationReport: CertificationReport.buildCertificationReport
};
