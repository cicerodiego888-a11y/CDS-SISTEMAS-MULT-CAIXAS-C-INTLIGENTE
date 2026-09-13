/**
 * Sprint 15.0 — DiscoveryLabLogger
 * Persiste probes Ethernet no Laboratório (TX/RX/HEX/tempo/driver/IP/porta/resultado).
 */

'use strict';

let engineeringLab = null;
function getLab() {
  if (engineeringLab) return engineeringLab;
  try {
    engineeringLab = require('../laboratorio/EngineeringLab');
  } catch (_) {
    engineeringLab = null;
  }
  return engineeringLab;
}

class DiscoveryLabLogger {
  constructor() {
    this._sessaoAtiva = false;
    this._registros = [];
  }

  async iniciar(meta = {}) {
    this._registros = [];
    const lab = getLab();
    if (!lab || typeof lab.start !== 'function') return null;
    try {
      await lab.start({
        equipamento: 'discovery-ethernet',
        driver: meta.driver || 'DISCOVERY',
        host: meta.host || null,
        porta: meta.porta != null ? meta.porta : null,
        persistir: meta.persistir !== false
      });
      this._sessaoAtiva = true;
      return lab.status ? lab.status() : null;
    } catch (_) {
      this._sessaoAtiva = false;
      return null;
    }
  }

  async registrarProbe(registro = {}) {
    this._registros.push({
      ...registro,
      registrado_em: new Date().toISOString()
    });

    const lab = getLab();
    if (!lab || !this._sessaoAtiva) return;

    try {
      if (registro.tx && typeof lab.observe === 'function') {
        await lab.observe('TX', registro.tx.bytes || Buffer.alloc(0), {
          host: registro.ip,
          porta: registro.porta,
          driver: registro.driver,
          resultado: registro.resultado,
          tempo_ms: registro.tempo_ms,
          origem: 'discovery-ethernet'
        });
      } else if (registro.hex_tx && typeof lab.observe === 'function') {
        await lab.observe('TX', Buffer.from(registro.hex_tx, 'hex'), {
          host: registro.ip,
          porta: registro.porta,
          driver: registro.driver,
          origem: 'discovery-ethernet'
        });
      }

      if (registro.rx && typeof lab.observe === 'function') {
        await lab.observe('RX', registro.rx.bytes || Buffer.alloc(0), {
          host: registro.ip,
          porta: registro.porta,
          driver: registro.driver,
          resultado: registro.resultado,
          tempo_ms: registro.tempo_ms,
          origem: 'discovery-ethernet'
        });
      } else if (registro.hex_rx && typeof lab.observe === 'function') {
        await lab.observe('RX', Buffer.from(registro.hex_rx, 'hex'), {
          host: registro.ip,
          porta: registro.porta,
          driver: registro.driver,
          origem: 'discovery-ethernet'
        });
      }
    } catch (_) { /* ignore */ }
  }

  async finalizar() {
    const lab = getLab();
    if (lab && this._sessaoAtiva && typeof lab.stop === 'function') {
      try { await lab.stop(); } catch (_) { /* ignore */ }
    }
    this._sessaoAtiva = false;
    return this._registros.slice();
  }

  obterRegistros() {
    return this._registros.slice();
  }
}

module.exports = DiscoveryLabLogger;
module.exports.DiscoveryLabLogger = DiscoveryLabLogger;
