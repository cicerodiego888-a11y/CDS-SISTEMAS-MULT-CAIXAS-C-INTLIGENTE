'use strict';

/**
 * EquipmentEventBus — Barramento corporativo RC5.0
 * Camada de integração (fora do Motor V1 congelado).
 */

const EventEmitter = require('events');

const EVENTOS = Object.freeze({
  EquipmentDiscovered: 'EquipmentDiscovered',
  EquipmentOnline: 'EquipmentOnline',
  EquipmentOffline: 'EquipmentOffline',
  EquipmentIdentityChanged: 'EquipmentIdentityChanged',
  EquipmentFirmwareChanged: 'EquipmentFirmwareChanged',
  EquipmentHealthChanged: 'EquipmentHealthChanged',
  EquipmentSyncStarted: 'EquipmentSyncStarted',
  EquipmentSyncFinished: 'EquipmentSyncFinished',
  EquipmentDiagnosticGenerated: 'EquipmentDiagnosticGenerated',
  EquipmentConfigurationChanged: 'EquipmentConfigurationChanged',
  // Aliases amigáveis (Central Inteligente)
  EquipamentoOnline: 'EquipmentOnline',
  EquipamentoOffline: 'EquipmentOffline',
  HeartbeatFalhou: 'HeartbeatFalhou',
  IpAlterado: 'EquipmentIdentityChanged',
  FirmwareAlterado: 'EquipmentFirmwareChanged',
  DiagnosticoGerado: 'EquipmentDiagnosticGenerated',
  SincronizacaoConcluida: 'EquipmentSyncFinished'
});

class EquipmentEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    /** @type {Array<Object>} */
    this._historico = [];
    this._maxHistor = 500;
  }

  /**
   * @param {string} evento
   * @param {Object} payload
   */
  publicar(evento, payload = {}) {
    const nome = EVENTOS[evento] || evento;
    const registro = {
      evento: nome,
      payload: payload || {},
      em: new Date().toISOString()
    };
    this._historico.push(registro);
    if (this._historico.length > this._maxHistor) {
      this._historico.shift();
    }
    this.emit(nome, registro);
    this.emit('*', registro);
    return registro;
  }

  /**
   * @param {string|string[]} eventos
   * @param {Function} handler
   */
  assinar(eventos, handler) {
    const lista = Array.isArray(eventos) ? eventos : [eventos];
    for (const ev of lista) {
      const nome = EVENTOS[ev] || ev;
      this.on(nome, handler);
    }
    return () => {
      for (const ev of lista) {
        const nome = EVENTOS[ev] || ev;
        this.off(nome, handler);
      }
    };
  }

  listarHistorico(limite = 50) {
    const n = Math.max(1, Math.min(200, Number(limite) || 50));
    return this._historico.slice(-n).reverse();
  }

  limparHistorico() {
    this._historico = [];
  }
}

const equipmentEventBus = new EquipmentEventBus();

module.exports = equipmentEventBus;
module.exports.EquipmentEventBus = EquipmentEventBus;
module.exports.EVENTOS = EVENTOS;
