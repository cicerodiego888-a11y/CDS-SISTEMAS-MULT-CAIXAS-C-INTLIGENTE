/**
 * Sprint 14.10 — MonitorSession
 */

'use strict';

const crypto = require('crypto');

const SESSION_STATUS = Object.freeze({
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED'
});

class MonitorSession {
  /**
   * @param {object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id || crypto.randomBytes(8).toString('hex');
    this.equipamento = {
      id: dados.equipamento_id != null ? dados.equipamento_id : (dados.equipamento && dados.equipamento.id) || null,
      host: dados.host || (dados.equipamento && dados.equipamento.host) || null,
      porta: dados.porta != null ? Number(dados.porta) : ((dados.equipamento && dados.equipamento.porta) || null)
    };
    this.iniciadoEm = dados.iniciadoEm || new Date().toISOString();
    this.ultimaVerificacao = dados.ultimaVerificacao || null;
    this.status = dados.status || SESSION_STATUS.IDLE;
    this.heartbeat = dados.heartbeat || 'UNKNOWN';
    this.latencia = dados.latencia != null ? Number(dados.latencia) : null;
    this.online = dados.online === true;
    this.config = {
      intervalMs: Number(dados.intervalMs) || 5000,
      timeoutMs: Number(dados.timeoutMs) || 2000,
      enabled: dados.enabled !== false,
      monitorEnabled: dados.monitorEnabled !== false
    };
  }

  snapshot() {
    return {
      id: this.id,
      equipamento: { ...this.equipamento },
      iniciadoEm: this.iniciadoEm,
      ultimaVerificacao: this.ultimaVerificacao,
      status: this.status,
      heartbeat: this.heartbeat,
      latencia: this.latencia,
      online: this.online,
      config: { ...this.config }
    };
  }
}

module.exports = MonitorSession;
module.exports.MonitorSession = MonitorSession;
module.exports.SESSION_STATUS = SESSION_STATUS;
