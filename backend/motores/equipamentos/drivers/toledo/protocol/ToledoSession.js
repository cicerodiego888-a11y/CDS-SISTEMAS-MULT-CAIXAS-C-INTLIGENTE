/**
 * Sprint 15.2 — ToledoSession
 * Ciclo de comunicação: IDLE → SEND → WAIT_RESPONSE → PARSE → SUCCESS|ERROR|TIMEOUT
 */

'use strict';

const STATES = Object.freeze({
  IDLE: 'IDLE',
  SEND: 'SEND',
  WAIT_RESPONSE: 'WAIT_RESPONSE',
  PARSE: 'PARSE',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  TIMEOUT: 'TIMEOUT'
});

class ToledoSession {
  constructor(meta = {}) {
    this.id = meta.id || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.estado = STATES.IDLE;
    this.comando = meta.comando || null;
    this.iniciadoEm = null;
    this.finalizadoEm = null;
    this.tx = null;
    this.rx = null;
    this.parsed = null;
    this.latenciaMs = null;
    this.erro = null;
    this.tentativa = 0;
    this.historico = [];
  }

  _transitar(para, meta = {}) {
    const from = this.estado;
    this.estado = para;
    this.historico.push({ from, to: para, em: new Date().toISOString(), ...meta });
  }

  iniciar(comando) {
    this.comando = comando;
    this.iniciadoEm = Date.now();
    this.finalizadoEm = null;
    this.erro = null;
    this.parsed = null;
    this.tx = null;
    this.rx = null;
    this._transitar(STATES.SEND, { comando });
  }

  marcarEnviado(txBuffer) {
    this.tx = Buffer.isBuffer(txBuffer) ? Buffer.from(txBuffer) : Buffer.from(txBuffer || []);
    this._transitar(STATES.WAIT_RESPONSE);
  }

  marcarRecebido(rxBuffer) {
    this.rx = Buffer.isBuffer(rxBuffer) ? Buffer.from(rxBuffer) : Buffer.from(rxBuffer || []);
    this.latenciaMs = this.iniciadoEm != null ? Date.now() - this.iniciadoEm : null;
    this._transitar(STATES.PARSE);
  }

  marcarSucesso(parsed) {
    this.parsed = parsed;
    this.finalizadoEm = Date.now();
    if (this.latenciaMs == null && this.iniciadoEm != null) {
      this.latenciaMs = this.finalizadoEm - this.iniciadoEm;
    }
    this._transitar(STATES.SUCCESS);
  }

  marcarErro(erro) {
    this.erro = {
      mensagem: erro?.message || String(erro),
      codigo: erro?.code || 'ERROR'
    };
    this.finalizadoEm = Date.now();
    this._transitar(STATES.ERROR, this.erro);
  }

  marcarTimeout() {
    this.erro = { mensagem: 'Timeout', codigo: 'PROTOCOL_TIMEOUT' };
    this.finalizadoEm = Date.now();
    this._transitar(STATES.TIMEOUT);
  }

  reset() {
    this.estado = STATES.IDLE;
    this.comando = null;
    this.tx = null;
    this.rx = null;
    this.parsed = null;
    this.erro = null;
    this.latenciaMs = null;
  }

  snapshot() {
    return {
      id: this.id,
      estado: this.estado,
      comando: this.comando,
      tentativa: this.tentativa,
      latenciaMs: this.latenciaMs,
      txHex: this.tx ? this.tx.toString('hex') : null,
      rxHex: this.rx ? this.rx.toString('hex') : null,
      checksum: this.parsed?.checksum || null,
      parsed: this.parsed
        ? {
          command: this.parsed.command || this.parsed.comando,
          payload: this.parsed.payload,
          valid: this.parsed.valid
        }
        : null,
      erro: this.erro,
      iniciadoEm: this.iniciadoEm,
      finalizadoEm: this.finalizadoEm
    };
  }
}

module.exports = ToledoSession;
module.exports.ToledoSession = ToledoSession;
module.exports.STATES = STATES;
