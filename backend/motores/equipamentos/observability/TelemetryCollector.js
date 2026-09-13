/**
 * Sprint 15.8 — TelemetryCollector
 * Coleta contínua com timestamp de heartbeats, latência, RX/TX, erros, jobs, sync, etc.
 */

'use strict';

const eventStream = require('./EventStream');
const repo = require('./ObservabilityRepository');

const TIPOS = Object.freeze({
  HEARTBEAT: 'heartbeat',
  LATENCIA: 'latencia',
  TEMPO_RESPOSTA: 'tempo_resposta',
  RECONEXAO: 'reconexao',
  BYTES_RX: 'bytes_rx',
  BYTES_TX: 'bytes_tx',
  ERRO: 'erro',
  TIMEOUT: 'timeout',
  JOB: 'job',
  SYNC: 'sincronizacao',
  ROLLBACK: 'rollback',
  DISCOVERY: 'discovery'
});

class TelemetryCollector {
  constructor() {
    /** @type {Array<Object>} */
    this._series = [];
    this._max = 2000;
    this._contadores = {
      heartbeats: 0,
      erros: 0,
      timeouts: 0,
      reconexoes: 0,
      jobs: 0,
      syncs: 0,
      rollbacks: 0,
      discovery: 0,
      bytesRx: 0,
      bytesTx: 0
    };
  }

  /**
   * @param {string} metrica
   * @param {number} valor
   * @param {Object} [ctx]
   */
  async record(metrica, valor, ctx = {}) {
    const ponto = {
      metrica: String(metrica),
      valor: Number(valor),
      unidade: ctx.unidade || null,
      equipamentoId: ctx.equipamentoId ?? null,
      driverId: ctx.driverId || null,
      fabricante: ctx.fabricante || null,
      protocolo: ctx.protocolo || null,
      loja: ctx.loja || null,
      tags: ctx.tags || {},
      registradoEm: ctx.registradoEm || new Date().toISOString()
    };

    this._series.unshift(ponto);
    if (this._series.length > this._max) this._series.length = this._max;

    this._atualizarContadores(ponto);

    try {
      await repo.inserirMetrica(ponto);
    } catch {
      /* best-effort */
    }

    if (ctx.emitEvent !== false) {
      await eventStream.push({
        tipo: `telemetry.${ponto.metrica}`,
        severidade: ponto.metrica === TIPOS.ERRO || ponto.metrica === TIPOS.TIMEOUT ? 'warning' : 'info',
        equipamentoId: ponto.equipamentoId,
        driverId: ponto.driverId,
        mensagem: `${ponto.metrica}=${ponto.valor}`,
        payload: ponto
      });
    }

    return ponto;
  }

  _atualizarContadores(p) {
    const m = p.metrica;
    if (m === TIPOS.HEARTBEAT) this._contadores.heartbeats += 1;
    if (m === TIPOS.ERRO) this._contadores.erros += 1;
    if (m === TIPOS.TIMEOUT) this._contadores.timeouts += 1;
    if (m === TIPOS.RECONEXAO) this._contadores.reconexoes += 1;
    if (m === TIPOS.JOB) this._contadores.jobs += 1;
    if (m === TIPOS.SYNC) this._contadores.syncs += 1;
    if (m === TIPOS.ROLLBACK) this._contadores.rollbacks += 1;
    if (m === TIPOS.DISCOVERY) this._contadores.discovery += 1;
    if (m === TIPOS.BYTES_RX) this._contadores.bytesRx += Number(p.valor) || 0;
    if (m === TIPOS.BYTES_TX) this._contadores.bytesTx += Number(p.valor) || 0;
  }

  // helpers tipados
  heartbeat(valor, ctx) { return this.record(TIPOS.HEARTBEAT, valor, ctx); }
  latencia(ms, ctx) { return this.record(TIPOS.LATENCIA, ms, { ...ctx, unidade: 'ms' }); }
  tempoResposta(ms, ctx) { return this.record(TIPOS.TEMPO_RESPOSTA, ms, { ...ctx, unidade: 'ms' }); }
  reconexao(ctx) { return this.record(TIPOS.RECONEXAO, 1, ctx); }
  bytesRx(n, ctx) { return this.record(TIPOS.BYTES_RX, n, { ...ctx, unidade: 'bytes' }); }
  bytesTx(n, ctx) { return this.record(TIPOS.BYTES_TX, n, { ...ctx, unidade: 'bytes' }); }
  erro(ctx) { return this.record(TIPOS.ERRO, 1, ctx); }
  timeout(ctx) { return this.record(TIPOS.TIMEOUT, 1, ctx); }
  job(ok, ctx) { return this.record(TIPOS.JOB, ok ? 1 : 0, ctx); }
  sync(ok, ctx) { return this.record(TIPOS.SYNC, ok ? 1 : 0, ctx); }
  rollback(ctx) { return this.record(TIPOS.ROLLBACK, 1, ctx); }
  discovery(qtd, ctx) { return this.record(TIPOS.DISCOVERY, qtd, ctx); }

  series({ metrica = null, limite = 200 } = {}) {
    let lista = this._series;
    if (metrica) lista = lista.filter((p) => p.metrica === metrica);
    return lista.slice(0, Math.min(Number(limite) || 200, this._max));
  }

  contadores() {
    return { ...this._contadores };
  }

  snapshot() {
    return {
      contadores: this.contadores(),
      recentes: this.series({ limite: 50 }),
      totalPontos: this._series.length,
      geradoEm: new Date().toISOString()
    };
  }

  limpar() {
    this._series = [];
    Object.keys(this._contadores).forEach((k) => { this._contadores[k] = 0; });
  }
}

const telemetryCollector = new TelemetryCollector();

module.exports = telemetryCollector;
module.exports.TelemetryCollector = TelemetryCollector;
module.exports.TIPOS = TIPOS;
