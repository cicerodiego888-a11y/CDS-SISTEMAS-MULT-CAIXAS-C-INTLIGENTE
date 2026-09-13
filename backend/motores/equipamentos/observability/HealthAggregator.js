/**
 * Sprint 15.8 — HealthAggregator
 * Consolida saúde do parque (monitor + orquestrador + telemetria + alertas)
 */

'use strict';

const telemetry = require('./TelemetryCollector');
const alertEngine = require('./AlertEngine');
const eventStream = require('./EventStream');

async function _safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

class HealthAggregator {
  async agregar() {
    const contadores = telemetry.contadores();
    const alertas = await alertEngine.listar({ ativos: true, limite: 50 });

    const orch = await _safe(() => {
      const { getOrchestrator } = require('../orchestrator');
      return getOrchestrator().dashboard();
    }, null);

    const monitor = await _safe(() => {
      const EquipmentMonitor = require('../monitor/EquipmentMonitor');
      return EquipmentMonitor.status ? EquipmentMonitor.status() : null;
    }, null);

    const sdk = await _safe(() => {
      const s = require('../sdk');
      s.ensureLoaded();
      return {
        drivers: s.registry.tamanho(),
        relatorio: s.loader.obterRelatorio()
      };
    }, { drivers: 0 });

    const online = orch?.resumo?.online ?? orch?.online ?? null;
    const offline = orch?.resumo?.offline ?? orch?.offline ?? null;
    const jobs = orch?.resumo?.filaPendentes ?? orch?.fila ?? contadores.jobs;

    let status = 'SAUDAVEL';
    if (alertas.some((a) => a.severidade === 'critical')) status = 'CRITICO';
    else if (alertas.length > 0 || (offline != null && offline > 0)) status = 'ATENCAO';

    return {
      status,
      indicadores: {
        online,
        offline,
        alertasAtivos: alertas.length,
        jobs,
        heartbeats: contadores.heartbeats,
        erros: contadores.erros,
        timeouts: contadores.timeouts,
        reconexoes: contadores.reconexoes,
        syncs: contadores.syncs,
        driversSdk: sdk.drivers
      },
      alertas: alertas.slice(0, 10),
      eventosRecentes: eventStream.listar({ limite: 15 }),
      monitor,
      orchestrator: orch ? { resumo: orch.resumo || orch } : null,
      geradoEm: new Date().toISOString()
    };
  }
}

const healthAggregator = new HealthAggregator();

module.exports = healthAggregator;
module.exports.HealthAggregator = HealthAggregator;
