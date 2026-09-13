/**
 * Sprint 15.1 — ConnectionHeartbeat
 * Heartbeat automático a cada 30s. Sem resposta → dispara reconexão.
 */

'use strict';

const INTERVALO_PADRAO_MS = 30000;

class ConnectionHeartbeat {
  /**
   * @param {{intervaloMs?:number, onTick?:Function, onFalha?:Function}} [opcoes]
   */
  constructor(opcoes = {}) {
    this.intervaloMs = Math.max(1000, Number(opcoes.intervaloMs) || INTERVALO_PADRAO_MS);
    this.onTick = typeof opcoes.onTick === 'function' ? opcoes.onTick : null;
    this.onFalha = typeof opcoes.onFalha === 'function' ? opcoes.onFalha : null;
    this._timer = null;
    this._rodando = false;
    this._ultimoOk = null;
  }

  get ativo() {
    return this._rodando === true;
  }

  get ultimoOk() {
    return this._ultimoOk;
  }

  iniciar() {
    if (this._rodando) return;
    this._rodando = true;
    this._timer = setInterval(() => this._executar(), this.intervaloMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  parar() {
    this._rodando = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _executar() {
    if (!this.onTick) return;
    try {
      const resultado = await this.onTick();
      if (resultado && resultado.ok === false) {
        this._ultimoOk = false;
        if (this.onFalha) await this.onFalha(resultado);
        return;
      }
      this._ultimoOk = true;
    } catch (err) {
      this._ultimoOk = false;
      if (this.onFalha) {
        try { await this.onFalha({ ok: false, erro: err }); } catch (_) { /* ignore */ }
      }
    }
  }

  /** Dispara um tick imediato (testes / ping manual). */
  async tickAgora() {
    return this._executar();
  }
}

module.exports = ConnectionHeartbeat;
module.exports.ConnectionHeartbeat = ConnectionHeartbeat;
module.exports.INTERVALO_PADRAO_MS = INTERVALO_PADRAO_MS;
