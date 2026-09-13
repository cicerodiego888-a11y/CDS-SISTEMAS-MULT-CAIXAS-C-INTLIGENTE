/**
 * Sprint 15.8 — ObservabilityController
 */

'use strict';

const telemetry = require('./TelemetryCollector');
const metrics = require('./MetricsAggregator');
const eventStream = require('./EventStream');
const alertEngine = require('./AlertEngine');
const health = require('./HealthAggregator');
const performance = require('./EquipmentPerformanceAnalyzer');
const audit = require('./EquipmentAuditService');
const suite = require('./DriverCertificationSuite');
const repo = require('./ObservabilityRepository');

function ok(res, data) {
  return res.json({ success: true, ...data });
}

function fail(res, error, status = 500) {
  return res.status(status).json({ success: false, error: error.message || String(error) });
}

const ObservabilityController = {
  async telemetry(req, res) {
    try {
      await repo.garantirSchema();
      return ok(res, {
        telemetry: telemetry.snapshot(),
        persistido: await repo.listarMetricas({
          limite: Number(req.query.limite) || 100,
          metrica: req.query.metrica || null
        })
      });
    } catch (error) {
      return fail(res, error);
    }
  },

  async metrics(req, res) {
    try {
      return ok(res, { metrics: metrics.agregar({
        desde: req.query.desde || null,
        limite: Number(req.query.limite) || 1000
      }) });
    } catch (error) {
      return fail(res, error);
    }
  },

  async events(req, res) {
    try {
      const limite = Number(req.query.limite) || 100;
      const tipo = req.query.tipo || null;
      return ok(res, {
        events: eventStream.listar({ limite, tipo }),
        persistido: await eventStream.listarPersistido({ limite, tipo })
      });
    } catch (error) {
      return fail(res, error);
    }
  },

  async alerts(req, res) {
    try {
      const ativos = req.query.ativos !== '0';
      return ok(res, {
        alerts: await alertEngine.listar({
          ativos,
          limite: Number(req.query.limite) || 100
        })
      });
    } catch (error) {
      return fail(res, error);
    }
  },

  async performance(req, res) {
    try {
      return ok(res, {
        performance: performance.analisar({
          limite: Number(req.query.limite) || 1000
        }),
        health: await health.agregar()
      });
    } catch (error) {
      return fail(res, error);
    }
  },

  async health(req, res) {
    try {
      return ok(res, { health: await health.agregar() });
    } catch (error) {
      return fail(res, error);
    }
  },

  async certificationRun(req, res) {
    try {
      const body = req.body || {};
      const todos = body.todos === true || req.query.todos === '1';

      if (todos) {
        const lote = await suite.executarTodos({
          executadoPor: body.executadoPor || req.usuario?.nome || 'api',
          firmware: body.firmware
        });
        const salvos = [];
        for (const r of lote.resultados) {
          salvos.push(await audit.certificar({
            driverId: r.driverId,
            evidencias: body.evidencias,
            firmware: body.firmware,
            executadoPor: body.executadoPor || req.usuario?.nome || 'api',
            observacoes: body.observacoes
          }));
        }
        return ok(res, { lote, salvos: salvos.map((s) => ({ id: s.id, resultado: s.resultado.resultado, nota: s.resultado.nota, driverId: s.resultado.driverId })) });
      }

      const out = await audit.certificar({
        driverId: body.driverId || req.query.driverId || 'toledo-prix4',
        evidencias: body.evidencias,
        firmware: body.firmware,
        executadoPor: body.executadoPor || req.usuario?.nome || 'api',
        observacoes: body.observacoes
      });
      return ok(res, out);
    } catch (error) {
      return fail(res, error);
    }
  },

  async certificationReport(req, res) {
    try {
      const driverId = req.query.driverId || null;
      const rel = await audit.obterRelatorio(driverId);
      if (!rel) {
        return fail(res, new Error('Nenhum relatório de certificação encontrado'), 404);
      }
      const historico = await audit.historico({ driverId, limite: 20 });
      return ok(res, { report: rel, historico });
    } catch (error) {
      return fail(res, error);
    }
  },

  /** Lab / ingestão manual de telemetria (opcional) */
  async ingest(req, res) {
    try {
      const body = req.body || {};
      const ponto = await telemetry.record(
        body.metrica || 'custom',
        body.valor != null ? body.valor : 1,
        body
      );
      if (body.avaliarAlertas) {
        await alertEngine.avaliar(body);
      }
      return ok(res, { ponto });
    } catch (error) {
      return fail(res, error);
    }
  }
};

module.exports = ObservabilityController;
