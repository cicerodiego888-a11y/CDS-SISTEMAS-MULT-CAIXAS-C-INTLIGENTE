/**
 * Sprint 15.8 — Observabilidade, Telemetria e Certificação
 */

'use strict';

const ObservabilityRepository = require('./ObservabilityRepository');
const telemetry = require('./TelemetryCollector');
const metrics = require('./MetricsAggregator');
const eventStream = require('./EventStream');
const alertEngine = require('./AlertEngine');
const health = require('./HealthAggregator');
const performance = require('./EquipmentPerformanceAnalyzer');
const DriverCertification = require('./DriverCertification');
const certificationSuite = require('./DriverCertificationSuite');
const CertificationReport = require('./CertificationReport');
const audit = require('./EquipmentAuditService');
const ObservabilityRoutes = require('./ObservabilityRoutes');
const ObservabilityController = require('./ObservabilityController');

async function bootstrap() {
  await ObservabilityRepository.garantirSchema();
  return { ok: true };
}

/**
 * Ponte leve: registra heartbeat do monitor na telemetria + avalia alertas.
 */
async function onMonitorHeartbeat(resultado = {}, ctx = {}) {
  const equipamentoId = ctx.equipamentoId ?? resultado.equipamentoId ?? null;
  const online = resultado.online !== false && resultado.success !== false;

  await telemetry.heartbeat(online ? 1 : 0, {
    equipamentoId,
    driverId: ctx.driverId,
    fabricante: ctx.fabricante,
    protocolo: ctx.protocolo
  });

  if (resultado.latencia != null) {
    await telemetry.latencia(resultado.latencia, { equipamentoId, driverId: ctx.driverId });
  }

  if (!online) {
    await telemetry.erro({ equipamentoId, driverId: ctx.driverId, tags: { motivo: 'offline' } });
  }

  await alertEngine.avaliar({
    equipamentoId,
    driverId: ctx.driverId,
    online,
    latenciaMs: resultado.latencia,
    heartbeatPerdido: resultado.heartbeat === false || resultado.error === 'timeout'
  });
}

module.exports = {
  ObservabilityRepository,
  telemetry,
  TelemetryCollector: telemetry,
  metrics,
  eventStream,
  alertEngine,
  health,
  performance,
  DriverCertification,
  certificationSuite,
  CertificationReport,
  audit,
  ObservabilityRoutes,
  ObservabilityController,
  bootstrap,
  onMonitorHeartbeat
};
