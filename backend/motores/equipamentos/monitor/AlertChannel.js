'use strict';

/**
 * Canal de alertas — RC3.1 (extensível)
 * Futuro: notificações, e-mail, WhatsApp, webhook, auditoria.
 */

const CANAIS = Object.freeze({
  LOG: 'log',
  EVENTO: 'evento',
  NOTIFICACAO: 'notificacao',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  WEBHOOK: 'webhook',
  AUDITORIA: 'auditoria'
});

class AlertChannel {
  constructor() {
    /** @type {Set<string>} */
    this._habilitados = new Set([CANAIS.LOG, CANAIS.EVENTO]);
    /** @type {Array<Function>} */
    this._listeners = [];
  }

  habilitar(canal) {
    this._habilitados.add(String(canal));
  }

  desabilitar(canal) {
    this._habilitados.delete(String(canal));
  }

  onAlerta(fn) {
    if (typeof fn === 'function') this._listeners.push(fn);
  }

  /**
   * Emite alerta para canais habilitados (stubs não-LOG apenas registram intenção).
   * @param {Object} alerta
   */
  async emitir(alerta = {}) {
    const registro = {
      ...alerta,
      em: new Date().toISOString(),
      canais: [...this._habilitados]
    };

    for (const fn of this._listeners) {
      try { await fn(registro); } catch (_) { /* ignore */ }
    }

    // Stubs futuros — sem side-effects externos nesta RC
    if (this._habilitados.has(CANAIS.EMAIL)) {
      registro.email_agendado = true;
    }
    if (this._habilitados.has(CANAIS.WHATSAPP)) {
      registro.whatsapp_agendado = true;
    }
    if (this._habilitados.has(CANAIS.WEBHOOK)) {
      registro.webhook_agendado = true;
    }

    return registro;
  }
}

const alertChannel = new AlertChannel();

module.exports = alertChannel;
module.exports.AlertChannel = AlertChannel;
module.exports.CANAIS = CANAIS;
