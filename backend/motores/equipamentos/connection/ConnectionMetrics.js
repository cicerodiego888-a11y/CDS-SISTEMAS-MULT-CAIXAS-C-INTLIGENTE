/**
 * Sprint 15.1 — ConnectionMetrics
 * Métricas por conexão (tempo online, bytes, latência, heartbeat).
 */

'use strict';

class ConnectionMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.conectadoDesde = null;
    this.tempoConectadoMs = 0;
    this.reconexoes = 0;
    this.pacotesEnviados = 0;
    this.pacotesRecebidos = 0;
    this.bytesEnviados = 0;
    this.bytesRecebidos = 0;
    this.latencias = [];
    this.ultimoHeartbeat = null;
    this.ultimoErro = null;
    this.heartbeatsOk = 0;
    this.heartbeatsFalha = 0;
  }

  marcarConectado(latencia = null) {
    this.conectadoDesde = Date.now();
    if (latencia != null) this.registrarLatencia(latencia);
  }

  marcarDesconectado() {
    if (this.conectadoDesde) {
      this.tempoConectadoMs += Date.now() - this.conectadoDesde;
    }
    this.conectadoDesde = null;
  }

  incrementarReconexoes() {
    this.reconexoes += 1;
  }

  registrarEnvio(bytes) {
    this.pacotesEnviados += 1;
    this.bytesEnviados += Math.max(0, Number(bytes) || 0);
  }

  registrarRecebimento(bytes) {
    this.pacotesRecebidos += 1;
    this.bytesRecebidos += Math.max(0, Number(bytes) || 0);
  }

  registrarLatencia(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return;
    this.latencias.push(n);
    if (this.latencias.length > 50) this.latencias.shift();
  }

  registrarHeartbeat(ok, meta = {}) {
    this.ultimoHeartbeat = new Date().toISOString();
    if (ok) this.heartbeatsOk += 1;
    else this.heartbeatsFalha += 1;
    if (meta.latencia != null) this.registrarLatencia(meta.latencia);
  }

  registrarErro(erro) {
    this.ultimoErro = {
      mensagem: erro?.message || String(erro || 'erro'),
      codigo: erro?.code || null,
      em: new Date().toISOString()
    };
  }

  get latenciaMedia() {
    if (!this.latencias.length) return null;
    const soma = this.latencias.reduce((a, b) => a + b, 0);
    return Math.round(soma / this.latencias.length);
  }

  get tempoOnlineMs() {
    const base = this.tempoConectadoMs;
    if (this.conectadoDesde) return base + (Date.now() - this.conectadoDesde);
    return base;
  }

  snapshot() {
    return {
      tempoConectadoMs: this.tempoOnlineMs,
      tempoOnline: formatUptime(this.tempoOnlineMs),
      reconexoes: this.reconexoes,
      pacotesEnviados: this.pacotesEnviados,
      pacotesRecebidos: this.pacotesRecebidos,
      bytesEnviados: this.bytesEnviados,
      bytesRecebidos: this.bytesRecebidos,
      latenciaMedia: this.latenciaMedia,
      ultimoHeartbeat: this.ultimoHeartbeat,
      ultimoErro: this.ultimoErro,
      heartbeatsOk: this.heartbeatsOk,
      heartbeatsFalha: this.heartbeatsFalha
    };
  }
}

function formatUptime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

module.exports = ConnectionMetrics;
module.exports.ConnectionMetrics = ConnectionMetrics;
module.exports.formatUptime = formatUptime;
