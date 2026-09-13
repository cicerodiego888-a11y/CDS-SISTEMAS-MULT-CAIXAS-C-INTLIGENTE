/**
 * Sprint 14.10 — EquipmentMonitor
 * Observação contínua via Operation Engine (PING) — sem PLU/peso/config remota.
 */

'use strict';

const MonitorScheduler = require('./MonitorScheduler');
const MonitorSession = require('./MonitorSession');
const { SESSION_STATUS } = require('./MonitorSession');
const MonitorRepository = require('./MonitorRepository');
const { MonitorEvents, EVENTS } = require('./MonitorEvents');
const { ToledoOperationEngine } = require('../drivers/toledo/operations/ToledoOperationEngine');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[monitor-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[monitor-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class EquipmentMonitor {
  constructor(deps = {}) {
    this.repository = deps.repository || new MonitorRepository();
    this.events = deps.events || new MonitorEvents();
    this.scheduler = deps.scheduler || new MonitorScheduler();
    this.operationEngine = deps.operationEngine || null;
    this._driverFactory = deps.driverFactory || null;
    this._engineFactory = deps.engineFactory || (() => new ToledoOperationEngine({
      persistir: true,
      driverFactory: this._driverFactory,
      drivers: deps.drivers
    }));
    /** @type {MonitorSession|null} */
    this.session = null;
    this._checking = false;
    this._lastResult = null;
  }

  _engine() {
    if (!this.operationEngine) {
      this.operationEngine = this._engineFactory();
    }
    return this.operationEngine;
  }

  status() {
    const mon = this.session;
    let sessionSnap = mon ? mon.snapshot() : null;
    // RC14.14.6 — estado de conexão vem só da EquipmentSession (CM)
    let conexaoMonitor = null;
    try {
      const cm = require('../connection/ConnectionManager');
      const alvo = mon?.equipamento
        ? { host: mon.equipamento.host, porta: mon.equipamento.porta }
        : null;
      if (alvo && alvo.host && alvo.porta && typeof cm.getSessionSnapshot === 'function') {
        conexaoMonitor = cm.getSessionSnapshot(alvo);
        // Espelha na MonitorSession para não divergir em snapshots legados
        if (mon && conexaoMonitor.session) {
          mon.online = conexaoMonitor.session.connected === true;
          mon.latencia = conexaoMonitor.session.latency;
          if (conexaoMonitor.session.heartbeatAt) {
            mon.ultimaVerificacao = conexaoMonitor.session.heartbeatAt;
          }
        }
        sessionSnap = mon ? mon.snapshot() : null;
      }
    } catch (_) { /* CM opcional */ }

    return {
      active: !!(mon && mon.status === SESSION_STATUS.ACTIVE),
      paused: !!(mon && mon.status === SESSION_STATUS.PAUSED),
      session: sessionSnap,
      scheduler: this.scheduler.config,
      last: this._lastResult,
      checking: this._checking,
      // Fonte única — idêntico à Conexão
      conexao: conexaoMonitor?.conexao || null,
      monitor: conexaoMonitor?.monitor || null,
      connectionSession: conexaoMonitor?.session || null,
      fonte: 'EquipmentSession'
    };
  }

  /**
   * Inicia monitoramento periódico.
   */
  async start(opcoes = {}) {
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    if (!host || !porta) {
      const err = new Error('host e porta obrigatórios');
      err.statusCode = 400;
      err.code = 'INVALID_INPUT';
      throw err;
    }

    let cfg = {
      monitorEnabled: opcoes.monitorEnabled != null ? !!opcoes.monitorEnabled : true,
      monitorIntervalMs: opcoes.intervalMs != null
        ? Number(opcoes.intervalMs)
        : (opcoes.monitorIntervalMs != null ? Number(opcoes.monitorIntervalMs) : 5000),
      heartbeatTimeoutMs: opcoes.timeoutMs != null
        ? Number(opcoes.timeoutMs)
        : (opcoes.heartbeatTimeoutMs != null ? Number(opcoes.heartbeatTimeoutMs) : 2000)
    };

    if (opcoes.equipamento_id != null && opcoes.persistir !== false) {
      try {
        const saved = await this.repository.obterConfig(opcoes.equipamento_id);
        cfg = {
          monitorEnabled: opcoes.monitorEnabled != null ? cfg.monitorEnabled : saved.monitorEnabled,
          monitorIntervalMs: opcoes.intervalMs != null || opcoes.monitorIntervalMs != null
            ? cfg.monitorIntervalMs
            : saved.monitorIntervalMs,
          heartbeatTimeoutMs: opcoes.timeoutMs != null || opcoes.heartbeatTimeoutMs != null
            ? cfg.heartbeatTimeoutMs
            : saved.heartbeatTimeoutMs
        };
        if (opcoes.salvarConfig) {
          await this.repository.salvarConfig(opcoes.equipamento_id, cfg);
        }
      } catch (_) { /* config opcional */ }
    }

    if (!cfg.monitorEnabled) {
      return { success: false, started: false, reason: 'monitorEnabled=false' };
    }

    if (this.session && (this.session.status === SESSION_STATUS.ACTIVE
      || this.session.status === SESSION_STATUS.PAUSED)) {
      await this.stop();
    }

    this.session = new MonitorSession({
      equipamento_id: opcoes.equipamento_id,
      host,
      porta,
      intervalMs: cfg.monitorIntervalMs,
      timeoutMs: cfg.heartbeatTimeoutMs,
      enabled: true,
      monitorEnabled: true,
      status: SESSION_STATUS.ACTIVE
    });

    const log = getLogger();
    await log.info('Monitor iniciado', {
      operacao: 'monitor_v1',
      contexto: this.session.snapshot()
    });

    this.events.emitStarted(this.session.snapshot());
    if (opcoes.persistir !== false) {
      await this.repository.registrar({
        equipamento_id: this.session.equipamento.id,
        status: 'ACTIVE',
        heartbeat: 'STARTED',
        evento: EVENTS.MONITOR_STARTED,
        host,
        porta,
        session_id: this.session.id
      });
    }

    this.scheduler.start({
      intervalMs: cfg.monitorIntervalMs,
      timeoutMs: cfg.heartbeatTimeoutMs,
      enabled: true,
      immediate: opcoes.immediate !== false,
      onTick: async () => {
        await this.checkHeartbeat({ persistir: opcoes.persistir !== false });
      }
    });

    return {
      success: true,
      started: true,
      session: this.session.snapshot()
    };
  }

  async pause() {
    if (!this.session || this.session.status === SESSION_STATUS.STOPPED) {
      return { success: false, paused: false, reason: 'no_session' };
    }
    this.scheduler.pause();
    this.session.status = SESSION_STATUS.PAUSED;
    this.events.emitPaused(this.session.snapshot());
    return { success: true, paused: true, session: this.session.snapshot() };
  }

  async resume() {
    if (!this.session || this.session.status === SESSION_STATUS.STOPPED) {
      return { success: false, resumed: false, reason: 'no_session' };
    }
    const r = this.scheduler.resume();
    if (!r.resumed && !this.scheduler._running) {
      this.scheduler.start({
        intervalMs: this.session.config.intervalMs,
        timeoutMs: this.session.config.timeoutMs,
        enabled: true,
        immediate: true,
        onTick: async () => {
          await this.checkHeartbeat({ persistir: true });
        }
      });
    }
    this.session.status = SESSION_STATUS.ACTIVE;
    this.events.emitResumed(this.session.snapshot());
    return { success: true, resumed: true, session: this.session.snapshot() };
  }

  async stop() {
    const log = getLogger();
    this.scheduler.stop();
    const snap = this.session ? this.session.snapshot() : null;
    if (this.session) {
      this.session.status = SESSION_STATUS.STOPPED;
      this.events.emitStopped(snap);
      await log.info('Monitor encerrado', {
        operacao: 'monitor_v1',
        contexto: snap
      });
      try {
        await this.repository.registrar({
          equipamento_id: this.session.equipamento.id,
          status: 'STOPPED',
          heartbeat: this.session.heartbeat,
          latencia: this.session.latencia,
          evento: EVENTS.MONITOR_STOPPED,
          host: this.session.equipamento.host,
          porta: this.session.equipamento.porta,
          session_id: this.session.id
        });
      } catch (_) { /* ignore */ }
    }
    this.session = null;
    return { success: true, stopped: true, session: snap };
  }

  /**
   * Verifica conectividade via Operation Engine PING.
   */
  async checkConnection(opcoes = {}) {
    return this.checkHeartbeat(opcoes);
  }

  /**
   * Heartbeat (PING) — não executa PLU nem peso.
   */
  async checkHeartbeat(opcoes = {}) {
    if (!this.session) {
      const err = new Error('Monitor sem sessão ativa');
      err.statusCode = 400;
      err.code = 'NO_SESSION';
      throw err;
    }
    if (this.session.status === SESSION_STATUS.PAUSED) {
      return { skipped: true, reason: 'paused' };
    }
    if (this._checking) {
      return { skipped: true, reason: 'busy' };
    }

    this._checking = true;
    const log = getLogger();
    const host = this.session.equipamento.host;
    const porta = this.session.equipamento.porta;
    const timeoutMs = opcoes.timeoutMs != null
      ? Number(opcoes.timeoutMs)
      : this.session.config.timeoutMs;

    try {
      const engine = this._engine();
      const result = await engine.ping({
        host,
        porta,
        timeout: timeoutMs,
        persistir: true
      });

      const ok = result.success === true;
      const latencia = result.duration != null ? Number(result.duration) : null;
      this.session.ultimaVerificacao = new Date().toISOString();
      this.session.latencia = latencia;

      if (ok) {
        const wasOffline = this.session.online === false;
        this.session.online = true;
        this.session.heartbeat = 'OK';
        await log.info('Heartbeat', {
          operacao: 'monitor_v1',
          contexto: { host, porta, latencia, ok: true }
        });
        this.events.emitHeartbeatOk({
          sessionId: this.session.id,
          latencia,
          host,
          porta
        });
        if (wasOffline || this._lastResult == null || this._lastResult.online === false) {
          await log.info('Equipamento online', {
            operacao: 'monitor_v1',
            contexto: { host, porta }
          });
          this.events.emitOnline({
            sessionId: this.session.id,
            host,
            porta,
            latencia
          });
        }
      } else {
        await this._marcarOffline(result.error || 'PING_FAILED', { host, porta, timeout: false });
      }

      this._lastResult = {
        online: this.session.online,
        heartbeat: this.session.heartbeat,
        latencia,
        ultimaVerificacao: this.session.ultimaVerificacao,
        error: ok ? null : (result.error || 'PING_FAILED')
      };

      if (opcoes.persistir !== false) {
        await this.repository.registrar({
          equipamento_id: this.session.equipamento.id,
          status: this.session.online ? 'ONLINE' : 'OFFLINE',
          heartbeat: this.session.heartbeat,
          latencia,
          evento: ok ? EVENTS.HEARTBEAT_OK : EVENTS.HEARTBEAT_TIMEOUT,
          host,
          porta,
          session_id: this.session.id
        });
      }

      return { success: ok, ...this._lastResult };
    } catch (err) {
      const isTimeout = err.code === 'TIMEOUT'
        || err.code === 'WEIGHT_TIMEOUT'
        || String(err.message || '').toLowerCase().includes('timeout');
      await this._marcarOffline(err.message || err.code, {
        host,
        porta,
        timeout: isTimeout
      });
      this._lastResult = {
        online: false,
        heartbeat: isTimeout ? 'TIMEOUT' : 'ERROR',
        latencia: null,
        ultimaVerificacao: this.session.ultimaVerificacao,
        error: err.message || err.code
      };
      if (opcoes.persistir !== false) {
        try {
          await this.repository.registrar({
            equipamento_id: this.session.equipamento.id,
            status: 'OFFLINE',
            heartbeat: this._lastResult.heartbeat,
            latencia: null,
            evento: isTimeout ? EVENTS.HEARTBEAT_TIMEOUT : EVENTS.DEVICE_OFFLINE,
            host,
            porta,
            session_id: this.session.id
          });
        } catch (_) { /* ignore */ }
      }
      return { success: false, ...this._lastResult };
    } finally {
      this._checking = false;
    }
  }

  async _marcarOffline(motivo, { host, porta, timeout }) {
    const log = getLogger();
    const wasOnline = this.session.online === true;
    this.session.online = false;
    this.session.heartbeat = timeout ? 'TIMEOUT' : 'FAIL';
    this.session.ultimaVerificacao = new Date().toISOString();
    this.session.latencia = null;

    if (timeout) {
      this.events.emitHeartbeatTimeout({
        sessionId: this.session.id,
        host,
        porta,
        error: motivo
      });
    }
    if (wasOnline || this._lastResult == null || this._lastResult.online === true) {
      await log.info('Equipamento offline', {
        operacao: 'monitor_v1',
        contexto: { host, porta, motivo }
      });
      this.events.emitOffline({
        sessionId: this.session.id,
        host,
        porta,
        error: motivo
      });
    }
  }

  async history(filtros) {
    return this.repository.historico(filtros);
  }

  on(event, listener) {
    this.events.on(event, listener);
    return this;
  }
}

const equipmentMonitor = new EquipmentMonitor();

module.exports = equipmentMonitor;
module.exports.EquipmentMonitor = EquipmentMonitor;
module.exports.equipmentMonitor = equipmentMonitor;
