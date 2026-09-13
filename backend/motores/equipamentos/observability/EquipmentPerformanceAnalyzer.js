/**
 * Sprint 15.8 — EquipmentPerformanceAnalyzer
 */

'use strict';

const telemetry = require('./TelemetryCollector');
const { TIPOS } = telemetry;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(valores) {
  const nums = valores.filter((v) => Number.isFinite(v)).map(Number).sort((a, b) => a - b);
  if (!nums.length) {
    return {
      count: 0, min: null, max: null, media: null,
      p50: null, p95: null, p99: null
    };
  }
  const soma = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    min: nums[0],
    max: nums[nums.length - 1],
    media: soma / nums.length,
    p50: percentile(nums, 50),
    p95: percentile(nums, 95),
    p99: percentile(nums, 99)
  };
}

class EquipmentPerformanceAnalyzer {
  analisar(opcoes = {}) {
    const limite = Number(opcoes.limite) || 1000;
    const series = telemetry.series({ limite });

    const latencias = series.filter((p) => p.metrica === TIPOS.LATENCIA).map((p) => Number(p.valor));
    const tempos = series.filter((p) => p.metrica === TIPOS.TEMPO_RESPOSTA).map((p) => Number(p.valor));
    const syncs = series.filter((p) => p.metrica === TIPOS.SYNC);
    const jobs = series.filter((p) => p.metrica === TIPOS.JOB);
    const heartbeats = series.filter((p) => p.metrica === TIPOS.HEARTBEAT);
    const erros = series.filter((p) => p.metrica === TIPOS.ERRO || p.metrica === TIPOS.TIMEOUT);

    const syncOk = syncs.filter((p) => Number(p.valor) === 1).length;
    const jobOk = jobs.filter((p) => Number(p.valor) === 1).length;
    const hbOk = heartbeats.filter((p) => Number(p.valor) === 1).length;

    const totalOps = syncs.length + jobs.length + heartbeats.length;
    const falhas = erros.length + syncs.filter((p) => Number(p.valor) === 0).length;

    return {
      latencia: stats(latencias),
      tempoResposta: stats(tempos),
      tempoConexao: stats(latencias.length ? latencias : tempos),
      disponibilidade: heartbeats.length
        ? Number(((hbOk / heartbeats.length) * 100).toFixed(2))
        : null,
      taxaErro: totalOps
        ? Number(((falhas / Math.max(totalOps, 1)) * 100).toFixed(2))
        : (erros.length ? 100 : 0),
      eficienciaSync: syncs.length
        ? Number(((syncOk / syncs.length) * 100).toFixed(2))
        : null,
      eficienciaJobs: jobs.length
        ? Number(((jobOk / jobs.length) * 100).toFixed(2))
        : null,
      totais: {
        syncs: syncs.length,
        syncOk,
        jobs: jobs.length,
        jobOk,
        heartbeats: heartbeats.length,
        erros: erros.length
      },
      geradoEm: new Date().toISOString()
    };
  }
}

const analyzer = new EquipmentPerformanceAnalyzer();

module.exports = analyzer;
module.exports.EquipmentPerformanceAnalyzer = EquipmentPerformanceAnalyzer;
