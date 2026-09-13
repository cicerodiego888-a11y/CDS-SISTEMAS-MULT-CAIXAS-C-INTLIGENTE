/**
 * RC14.14.6 — EquipmentSession
 * Fonte única oficial do estado de conexão (CM → Monitor → Diagnóstico → Frontend).
 */

'use strict';

const SESSION_STATE = Object.freeze({
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR'
});

const CONNECTION_MODE = Object.freeze({
  NEW_CONNECTION: 'NEW_CONNECTION',
  REUSED_SESSION: 'REUSED_SESSION',
  AUTO_RECONNECT: 'AUTO_RECONNECT',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
  UNKNOWN: 'UNKNOWN'
});

/** Mapeia FSM interna (IDLE/BUSY/RECONNECTING…) para estados oficiais da sessão. */
function mapFsmToSessionState(fsmEstado) {
  const s = String(fsmEstado || '').toUpperCase();
  if (s === 'RECONNECTING') return SESSION_STATE.RECONNECTING;
  if (s === 'CONNECTING') return SESSION_STATE.CONNECTING;
  if (s === 'CONNECTED' || s === 'IDLE' || s === 'BUSY') return SESSION_STATE.CONNECTED;
  if (s === 'ERROR') return SESSION_STATE.ERROR;
  return SESSION_STATE.DISCONNECTED;
}

function agora() {
  return new Date().toISOString();
}

class EquipmentSession {
  /**
   * @param {{host?:string|null, porta?:number|null, equipamentoId?:number|null, transporte?:string}} meta
   */
  constructor(meta = {}) {
    this.host = meta.host || null;
    this.porta = meta.porta != null ? Number(meta.porta) : null;
    this.equipamentoId = meta.equipamentoId != null ? Number(meta.equipamentoId) : null;
    this.transporte = meta.transporte || 'ethernet';

    this.connected = false;
    this.state = SESSION_STATE.DISCONNECTED;
    this.connectedAt = null;
    this.disconnectedAt = null;
    this.heartbeatAt = null;
    this.latency = null;
    this.lastError = null;
    this.reconnectCount = 0;
    this.connectionMode = CONNECTION_MODE.UNKNOWN;
    this.persistent = false;
    /** RC15.10 — exclusão mútua com Heartbeat */
    this.busy = false;
    this.busyReason = null;
    this.busyDepth = 0;
    this.updatedAt = agora();
  }

  /**
   * RC15.10 — operação ativa (UPLOAD/DOWNLOAD/CONFIG/DIAGNOSTICO).
   * Heartbeat deve ignorar enquanto busy=true.
   */
  markBusy(reason = 'OP') {
    this.busyDepth = Math.max(0, Number(this.busyDepth) || 0) + 1;
    this.busy = true;
    this.busyReason = reason != null ? String(reason) : this.busyReason;
    this.updatedAt = agora();
    return this;
  }

  clearBusy(reason = null) {
    this.busyDepth = Math.max(0, (Number(this.busyDepth) || 0) - 1);
    if (this.busyDepth === 0) {
      this.busy = false;
      this.busyReason = null;
    } else if (reason != null && this.busyReason === String(reason)) {
      this.busyReason = reason;
    }
    this.updatedAt = agora();
    return this;
  }

  /**
   * @param {string} fsmEstado
   * @param {{mode?:string, latency?:number|null, error?:string|null, reconnect?:boolean}} [opts]
   */
  syncFromFsm(fsmEstado, opts = {}) {
    const next = mapFsmToSessionState(fsmEstado);
    const prev = this.state;
    this.state = next;
    this.connected = next === SESSION_STATE.CONNECTED;

    if (opts.mode) this.connectionMode = opts.mode;
    if (opts.latency != null) this.latency = Number(opts.latency);
    if (opts.error != null) this.lastError = opts.error;
    if (opts.reconnect === true) this.reconnectCount += 1;

    if (next === SESSION_STATE.CONNECTED && prev !== SESSION_STATE.CONNECTED) {
      this.connectedAt = agora();
      this.disconnectedAt = null;
      this.lastError = null;
    }
    if (next === SESSION_STATE.DISCONNECTED || next === SESSION_STATE.ERROR) {
      if (prev === SESSION_STATE.CONNECTED || prev === SESSION_STATE.CONNECTING) {
        this.disconnectedAt = agora();
      }
      if (next === SESSION_STATE.ERROR && opts.error) {
        this.lastError = opts.error;
      }
    }
    if (next === SESSION_STATE.CONNECTING) {
      this.connected = false;
    }

    this.updatedAt = agora();
    return this;
  }

  markConnecting(mode = CONNECTION_MODE.NEW_CONNECTION) {
    this.state = SESSION_STATE.CONNECTING;
    this.connected = false;
    this.connectionMode = mode;
    this.lastError = null;
    this.updatedAt = agora();
    return this;
  }

  markConnected(mode = CONNECTION_MODE.NEW_CONNECTION, latency = null, meta = {}) {
    const wasConnected = this.connected;
    this.state = SESSION_STATE.CONNECTED;
    this.connected = true;
    this.connectionMode = mode;
    if (meta && meta.host) this.host = String(meta.host);
    if (meta && meta.porta != null && Number.isFinite(Number(meta.porta))) {
      this.porta = Number(meta.porta);
    }
    if (meta && meta.equipamentoId != null) this.equipamentoId = Number(meta.equipamentoId);
    if (latency != null) this.latency = Number(latency);
    if (!wasConnected || !this.connectedAt) this.connectedAt = agora();
    this.disconnectedAt = null;
    this.lastError = null;
    // Incrementa só na transição para conectado (evita double-count no commit)
    if (mode === CONNECTION_MODE.AUTO_RECONNECT && !wasConnected) {
      this.reconnectCount += 1;
    }
    this.updatedAt = agora();
    return this;
  }

  markDisconnected(error = null) {
    this.state = SESSION_STATE.DISCONNECTED;
    this.connected = false;
    this.connectionMode = CONNECTION_MODE.DISCONNECTED;
    this.disconnectedAt = agora();
    if (error) this.lastError = String(error);
    this.updatedAt = agora();
    return this;
  }

  markError(error = null) {
    this.state = SESSION_STATE.ERROR;
    this.connected = false;
    this.connectionMode = CONNECTION_MODE.ERROR;
    this.disconnectedAt = agora();
    this.lastError = error ? String(error) : this.lastError;
    this.updatedAt = agora();
    return this;
  }

  touchHeartbeat(latency = null, mode = null) {
    this.heartbeatAt = agora();
    if (latency != null) this.latency = Number(latency);
    if (mode) this.connectionMode = mode;
    // Heartbeat bem-sucedido mantém CONNECTED
    if (this.connected) {
      this.state = SESSION_STATE.CONNECTED;
    }
    this.updatedAt = agora();
    return this;
  }

  /** RC14.14.8 — sessão permanente desejada enquanto ERP aberto */
  setPersistent(flag = true) {
    this.persistent = flag === true;
    this.updatedAt = agora();
    return this;
  }

  get tempoConexaoMs() {
    if (!this.connected || !this.connectedAt) return 0;
    return Math.max(0, Date.now() - new Date(this.connectedAt).getTime());
  }

  /**
   * Snapshot canônico — Conexão e Monitor devem ser idênticos nestes campos.
   */
  snapshot() {
    return {
      connected: this.connected,
      state: this.state,
      status: this.state,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      heartbeatAt: this.heartbeatAt,
      latency: this.latency,
      lastError: this.lastError,
      reconnectCount: this.reconnectCount,
      connectionMode: this.connectionMode,
      persistent: this.persistent === true,
      busy: this.busy === true,
      busyReason: this.busyReason,
      busyDepth: this.busyDepth,
      tempo_conexao: this.tempoConexaoMs,
      tempo_conexao_ms: this.tempoConexaoMs,
      ultimo_heartbeat: this.heartbeatAt,
      latencia: this.latency,
      host: this.host,
      porta: this.porta,
      equipamentoId: this.equipamentoId,
      updatedAt: this.updatedAt
    };
  }

  /** Blocos espelhados para JSON de diagnóstico (nunca divergem). */
  toConexaoMonitor() {
    const snap = this.snapshot();
    const bloco = {
      persistent: snap.persistent === true,
      status: snap.state,
      estado: snap.state,
      conectado: snap.connected,
      connected: snap.connected,
      host: snap.host,
      porta: snap.porta,
      tempo_conexao: snap.tempo_conexao_ms,
      ultimo_heartbeat: snap.heartbeatAt,
      latencia: snap.latency,
      connectionMode: snap.connectionMode,
      reconnectCount: snap.reconnectCount,
      lastError: snap.lastError,
      connectedAt: snap.connectedAt,
      disconnectedAt: snap.disconnectedAt
    };
    return {
      session: snap,
      conexao: { ...bloco },
      monitor: { ...bloco }
    };
  }
}

/**
 * Snapshot ausente — RC14.14.9: NÃO registra no registry (evita fantasma host=null).
 * Quando há host/porta ou id, reutiliza a sessão oficial do registry.
 */
function criarSessaoAusente(alvo = {}) {
  const registry = require('./EquipmentSessionRegistry');
  const host = alvo.host || alvo.ip;
  const porta = alvo.porta != null ? alvo.porta : alvo.porta_tcp;
  const id = alvo.equipamentoId ?? alvo.equipamento_id ?? alvo.id;
  if ((host && porta != null) || id != null) {
    const existing = registry.get(alvo);
    if (existing) return existing;
    return registry.getOrCreate(alvo);
  }
  return new EquipmentSession(alvo);
}

module.exports = {
  EquipmentSession,
  SESSION_STATE,
  CONNECTION_MODE,
  mapFsmToSessionState,
  criarSessaoAusente
};
