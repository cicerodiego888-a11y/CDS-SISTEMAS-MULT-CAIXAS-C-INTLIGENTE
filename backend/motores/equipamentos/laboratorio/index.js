/**
 * Laboratório de Equipamentos — exports públicos
 * Sprint 14.5 — Engineering Lab V2.0
 */

'use strict';

const laboratorioEquipamentos = require('./LaboratorioEquipamentos');
const engineeringLab = require('./EngineeringLab');

module.exports = {
  laboratorioEquipamentos,
  LaboratorioEquipamentos: laboratorioEquipamentos.LaboratorioEquipamentos,
  frameStudio: require('./FrameStudio'),
  packetInspector: require('./PacketInspector'),
  captureManager: require('./CaptureManager'),
  replayManager: require('./ReplayManager'),
  packetComparator: require('./PacketComparator'),
  diagnosticoEquipamentos: require('./DiagnosticoEquipamentos'),
  frameBuilderMap: require('./frameBuilderMap'),
  // V2.0
  engineeringLab,
  EngineeringLab: engineeringLab.EngineeringLab,
  CaptureSession: require('./CaptureSession'),
  FrameCapture: require('./FrameCapture'),
  FrameRepository: require('./FrameRepository'),
  FrameAnalyzer: require('./FrameAnalyzer'),
  FrameExporter: require('./FrameExporter'),
  CaptureController: require('./CaptureController'),
  CaptureRoutes: require('./CaptureRoutes'),
  // Sprint 15.7 — Device Profile SDK no lab
  deviceSdk: require('../sdk'),
  observability: require('../observability'),
  obterSdkLab() {
    const sdk = require('../sdk');
    sdk.ensureLoaded();
    const rel = sdk.loader.obterRelatorio() || {};
    return {
      drivers: sdk.registry.listar(),
      manifests: rel.carregados || [],
      capabilities: require('../sdk/DriverCapabilities').ALL_CANONICAL,
      validacao: { erros: rel.erros || [], ignorados: rel.ignorados || [] },
      registro: { total: sdk.registry.tamanho(), categorias: sdk.registry.listarCategorias() },
      tempoCargaMs: rel.tempoTotalMs || null,
      timestamp: rel.timestamp || null
    };
  },
  async obterObservabilityLab() {
    const obs = require('../observability');
    await obs.bootstrap();
    return {
      telemetry: obs.telemetry.snapshot(),
      events: obs.eventStream.listar({ limite: 30 }),
      alerts: await obs.alertEngine.listar({ limite: 20 }),
      metrics: obs.metrics.agregar({ limite: 500 }),
      performance: obs.performance.analisar({ limite: 500 }),
      certification: await obs.audit.obterRelatorio()
    };
  }
};
