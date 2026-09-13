/**
 * Utilitários de filtros rápidos da Central de Entradas (Sprint 7 / RC8.3.3 / RC3.7.1).
 * Períodos usam data_emissao. Filas de status vêm de FilasEstadosCentral (fonte única).
 *
 * @module motores/central-entradas/utils/filtrosRapidosCentral
 */

'use strict';

const { FILAS, obterFila } = require('../core/FilasEstadosCentral');

const PRESETS_PERIODO = Object.freeze({
  hoje: {
    label: 'Hoje',
    sql: "data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND date(data_emissao) = date('now', 'localtime')"
  },
  ontem: {
    label: 'Ontem',
    sql: "data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND date(data_emissao) = date('now', 'localtime', '-1 day')"
  },
  ultimos_7_dias: {
    label: 'Últimos 7 dias',
    sql: "data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND date(data_emissao) >= date('now', 'localtime', '-7 days')"
  },
  ultimos_30_dias: {
    label: 'Últimos 30 dias',
    sql: "data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND date(data_emissao) >= date('now', 'localtime', '-30 days')"
  },
  este_mes: {
    label: 'Este mês',
    sql: "data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND strftime('%Y-%m', data_emissao) = strftime('%Y-%m', 'now', 'localtime')"
  }
});

const PRESETS_FILA = Object.freeze(
  Object.fromEntries(
    Object.values(FILAS).map((f) => [f.codigo, { label: f.label, statusIn: [...f.statusIn] }])
  )
);

/** Aliases UX → fila canônica */
const PRESETS_ALIAS = Object.freeze({
  revisar: PRESETS_FILA.em_revisao,
  atencao: PRESETS_FILA.erro,
  xml: {
    label: 'Resumo / XML',
    statusIn: [...FILAS.pendentes.statusIn.filter((s) => s === 'RESUMO_RECEBIDO' || s === 'NOVA')]
  }
});

const PRESETS = Object.freeze({
  ...PRESETS_PERIODO,
  ...PRESETS_FILA,
  ...PRESETS_ALIAS
});

function obterPreset(preset) {
  if (PRESETS[preset]) return PRESETS[preset];
  const fila = obterFila(preset);
  if (fila) return { label: fila.label, statusIn: [...fila.statusIn] };
  return null;
}

function listarPresets() {
  return Object.entries(PRESETS).map(([codigo, meta]) => ({
    codigo,
    label: meta.label
  }));
}

module.exports = {
  PRESETS,
  obterPreset,
  listarPresets
};
