/**
 * RC4.32.0 — Métricas de performance da certificação de release
 * @module certification/ReleaseCertificationMetrics
 */
'use strict';

const { performance } = require('perf_hooks');
const os = require('os');

class ReleaseCertificationMetrics {
  constructor() {
    this.inicio = Date.now();
    this.etapas = [];
    this.excecoes = [];
    this.consultasSql = 0;
    this._heapInicio = process.memoryUsage().heapUsed;
    this._heapMax = this._heapInicio;
    this._cpuInicio = process.cpuUsage();
  }

  iniciarEtapa(nome) {
    return {
      nome,
      t0: performance.now(),
      memInicio: process.memoryUsage().heapUsed
    };
  }

  finalizarEtapa(ctx, resultado = 'OK', detalhe = null) {
    const tempoMs = Math.round(performance.now() - ctx.t0);
    const memAtual = process.memoryUsage().heapUsed;
    if (memAtual > this._heapMax) this._heapMax = memAtual;
    this.etapas.push({
      nome: ctx.nome,
      resultado,
      tempoMs,
      memoriaMb: Math.round(memAtual / 1024 / 1024 * 10) / 10,
      detalhe
    });
    return tempoMs;
  }

  registrarExcecao(etapa, err) {
    this.excecoes.push({
      etapa,
      mensagem: err.message || String(err),
      stack: (err.stack || '').split('\n').slice(0, 5).join(' | ')
    });
  }

  incrementarSql(n = 1) {
    this.consultasSql += n;
  }

  resumo() {
    const cpu = process.cpuUsage(this._cpuInicio);
    const totalMs = Date.now() - this.inicio;
    return {
      tempoTotalMs: totalMs,
      tempoTotalSeg: Math.round(totalMs / 100) / 10,
      memoriaMaxMb: Math.round(this._heapMax / 1024 / 1024 * 10) / 10,
      memoriaAtualMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 10) / 10,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      quantidadeEtapas: this.etapas.length,
      quantidadeExcecoes: this.excecoes.length,
      quantidadeConsultasSql: this.consultasSql,
      plataforma: `${os.platform()} ${os.release()}`,
      node: process.version
    };
  }

  exportar() {
    return {
      etapas: [...this.etapas],
      excecoes: [...this.excecoes],
      resumo: this.resumo()
    };
  }
}

module.exports = { ReleaseCertificationMetrics };
