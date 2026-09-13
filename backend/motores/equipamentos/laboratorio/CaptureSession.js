/**
 * Sprint 14.5 — CaptureSession
 */

'use strict';

let seq = 0;

function novoId() {
  seq += 1;
  return String(seq).padStart(5, '0');
}

class CaptureSession {
  /**
   * @param {object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id || novoId();
    this.iniciadoEm = dados.iniciadoEm || new Date().toISOString();
    this.finalizadoEm = dados.finalizadoEm || null;
    this.equipamento = dados.equipamento || null;
    this.driver = dados.driver || null;
    this.host = dados.host || null;
    this.porta = dados.porta != null ? Number(dados.porta) : null;
    this.totalFrames = Number(dados.totalFrames) || 0;
    this.totalTX = Number(dados.totalTX) || 0;
    this.totalRX = Number(dados.totalRX) || 0;
    this.status = dados.status || 'RECORDING'; // RECORDING | PAUSED | STOPPED
  }

  registrar(direction) {
    this.totalFrames += 1;
    if (direction === 'TX') this.totalTX += 1;
    if (direction === 'RX') this.totalRX += 1;
  }

  pause() {
    if (this.status === 'RECORDING') this.status = 'PAUSED';
  }

  resume() {
    if (this.status === 'PAUSED') this.status = 'RECORDING';
  }

  stop() {
    this.status = 'STOPPED';
    this.finalizadoEm = new Date().toISOString();
  }

  get gravando() {
    return this.status === 'RECORDING';
  }

  get uptimeMs() {
    const fim = this.finalizadoEm ? new Date(this.finalizadoEm).getTime() : Date.now();
    return Math.max(0, fim - new Date(this.iniciadoEm).getTime());
  }

  get uptime() {
    const total = Math.floor(this.uptimeMs / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  paraApi() {
    return {
      id: this.id,
      iniciadoEm: this.iniciadoEm,
      finalizadoEm: this.finalizadoEm,
      equipamento: this.equipamento,
      driver: this.driver,
      host: this.host,
      porta: this.porta,
      totalFrames: this.totalFrames,
      totalTX: this.totalTX,
      totalRX: this.totalRX,
      status: this.status,
      uptime: this.uptime
    };
  }
}

/** Apenas testes */
function _resetSeq(n = 0) {
  seq = n;
}

module.exports = CaptureSession;
module.exports.CaptureSession = CaptureSession;
module.exports._resetSeq = _resetSeq;
