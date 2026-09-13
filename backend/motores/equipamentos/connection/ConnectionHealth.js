/**
 * Sprint 14.3 — Estados de saúde da conexão TCP.
 * Sem protocolo / sem Driver.
 */

'use strict';

const STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  DISCONNECTED: 'DISCONNECTED',
  TIMEOUT: 'TIMEOUT'
});

/** Alias HTTP do aceite (CONNECTED ≡ ONLINE). */
const STATUS_API = Object.freeze({
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  TIMEOUT: 'TIMEOUT',
  OFFLINE: 'OFFLINE'
});

function formatUptime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

class ConnectionHealth {
  constructor(dados = {}) {
    this.status = dados.status || STATUS.OFFLINE;
    this.latencia = dados.latencia != null ? Number(dados.latencia) : null;
    this.conectadoEm = dados.conectadoEm || null;
    this.desconectadoEm = dados.desconectadoEm || null;
    this.ultimaAtividade = dados.ultimaAtividade || null;
    this.reconexoes = Number(dados.reconexoes) || 0;
  }

  setStatus(status) {
    this.status = status;
    this.touch();
  }

  touch() {
    this.ultimaAtividade = new Date().toISOString();
  }

  marcarConectado(latencia = null) {
    this.status = STATUS.ONLINE;
    this.latencia = latencia != null ? Number(latencia) : this.latencia;
    this.conectadoEm = new Date().toISOString();
    this.desconectadoEm = null;
    this.touch();
  }

  marcarDesconectado(status = STATUS.DISCONNECTED) {
    this.status = status;
    this.desconectadoEm = new Date().toISOString();
    this.touch();
  }

  incrementarReconexoes() {
    this.reconexoes += 1;
    this.touch();
  }

  get uptimeMs() {
    if (!this.conectadoEm || this.status !== STATUS.ONLINE) return 0;
    return Date.now() - new Date(this.conectadoEm).getTime();
  }

  get uptime() {
    return formatUptime(this.uptimeMs);
  }

  get isOnline() {
    return this.status === STATUS.ONLINE;
  }

  /** Formato HTTP do aceite. */
  paraApi() {
    const statusApi = this.status === STATUS.ONLINE
      ? STATUS_API.CONNECTED
      : (this.status === STATUS.OFFLINE ? STATUS_API.OFFLINE : this.status);
    return {
      status: statusApi,
      latencia: this.latencia,
      uptime: this.uptime,
      ultima_atividade: this.ultimaAtividade,
      reconexoes: this.reconexoes,
      conectado_em: this.conectadoEm,
      desconectado_em: this.desconectadoEm
    };
  }

  snapshot() {
    return {
      status: this.status,
      latencia: this.latencia,
      conectadoEm: this.conectadoEm,
      desconectadoEm: this.desconectadoEm,
      ultimaAtividade: this.ultimaAtividade,
      reconexoes: this.reconexoes,
      uptime: this.uptime,
      uptimeMs: this.uptimeMs
    };
  }
}

module.exports = ConnectionHealth;
module.exports.ConnectionHealth = ConnectionHealth;
module.exports.STATUS = STATUS;
module.exports.STATUS_API = STATUS_API;
module.exports.formatUptime = formatUptime;
