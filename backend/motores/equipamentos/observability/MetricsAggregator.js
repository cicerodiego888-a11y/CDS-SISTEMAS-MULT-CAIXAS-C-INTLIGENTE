/**
 * Sprint 15.8 — MetricsAggregator
 * Consolida por equipamento / driver / fabricante / protocolo / loja / período
 */

'use strict';

const telemetry = require('./TelemetryCollector');

function agrupar(series, chaveFn) {
  const map = new Map();
  for (const p of series) {
    const key = chaveFn(p) || 'desconhecido';
    if (!map.has(key)) {
      map.set(key, {
        chave: key,
        pontos: 0,
        soma: 0,
        min: null,
        max: null,
        porMetrica: {}
      });
    }
    const g = map.get(key);
    g.pontos += 1;
    const v = Number(p.valor);
    if (Number.isFinite(v)) {
      g.soma += v;
      g.min = g.min == null ? v : Math.min(g.min, v);
      g.max = g.max == null ? v : Math.max(g.max, v);
    }
    const m = p.metrica || 'outro';
    if (!g.porMetrica[m]) g.porMetrica[m] = { count: 0, soma: 0 };
    g.porMetrica[m].count += 1;
    if (Number.isFinite(v)) g.porMetrica[m].soma += v;
  }

  return Array.from(map.values()).map((g) => ({
    ...g,
    media: g.pontos ? g.soma / g.pontos : null
  }));
}

class MetricsAggregator {
  agregar(opcoes = {}) {
    const limite = Number(opcoes.limite) || 1000;
    const series = telemetry.series({ limite });
    const desde = opcoes.desde ? new Date(opcoes.desde).getTime() : null;
    const filtrada = desde
      ? series.filter((p) => new Date(p.registradoEm).getTime() >= desde)
      : series;

    return {
      periodo: {
        desde: opcoes.desde || null,
        ate: new Date().toISOString(),
        pontos: filtrada.length
      },
      contadores: telemetry.contadores(),
      porEquipamento: agrupar(filtrada, (p) => (p.equipamentoId != null ? String(p.equipamentoId) : null)),
      porDriver: agrupar(filtrada, (p) => p.driverId),
      porFabricante: agrupar(filtrada, (p) => p.fabricante),
      porProtocolo: agrupar(filtrada, (p) => p.protocolo),
      porLoja: agrupar(filtrada, (p) => p.loja),
      geradoEm: new Date().toISOString()
    };
  }
}

const metricsAggregator = new MetricsAggregator();

module.exports = metricsAggregator;
module.exports.MetricsAggregator = MetricsAggregator;
