/**
 * HealthScheduler — varredura periódica local (RC3.4.6).
 * Sem SEFAZ / sem alterar MIRX.
 *
 * @module motores/central-entradas/health/HealthScheduler
 */

const HealthMonitor = require('./HealthMonitor');
const { logCentral, logCentralErro } = require('../utils/centralLog');

const INTERVALO_MS = 5 * 60 * 1000;
const DELAY_BOOT_MS = 8 * 1000;

class HealthScheduler {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._monitor = deps.monitor || new HealthMonitor(deps);
    this._intervaloMs = deps.intervaloMs != null ? deps.intervaloMs : INTERVALO_MS;
    this._timeoutId = null;
    this._ativo = false;
    this._emExecucao = false;
  }

  obterMonitor() {
    return this._monitor;
  }

  estaAtivo() {
    return this._ativo;
  }

  async iniciar() {
    if (this._ativo) return;
    this._ativo = true;
    logCentral('HEALTH', {
      Evento: 'HEALTH_SCHEDULER_START',
      IntervaloMs: this._intervaloMs
    });
    this._agendar(DELAY_BOOT_MS);
  }

  parar() {
    this._ativo = false;
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    logCentral('HEALTH', { Evento: 'HEALTH_SCHEDULER_STOP' });
  }

  /** @private */
  _agendar(delayMs) {
    if (this._timeoutId) clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(() => {
      this._tick().catch((error) => {
        logCentralErro('HEALTH', error, { Evento: 'HEALTH_TICK_ERRO' });
      });
    }, Math.max(0, delayMs));
  }

  /** @private */
  async _tick() {
    if (!this._ativo) return;
    if (this._emExecucao) {
      this._agendar(this._intervaloMs);
      return;
    }
    this._emExecucao = true;
    try {
      await this._monitor.executarScan({ autoRecuperar: true });
    } finally {
      this._emExecucao = false;
      if (this._ativo) this._agendar(this._intervaloMs);
    }
  }

  async forcarScan(opcoes = {}) {
    return this._monitor.executarScan(opcoes);
  }
}

const instancia = new HealthScheduler();
module.exports = instancia;
module.exports.HealthScheduler = HealthScheduler;
module.exports.INTERVALO_MS = INTERVALO_MS;
