/**
 * Detector de lacunas aparentes de NSU (Sprint 3).
 * NÃO fabrica NSU. NÃO altera cursor. Somente diagnostica.
 *
 * @module motores/central-entradas/descoberta-nsu/NsuLacunaDetector
 */
'use strict';

const { DistNsuStatus } = require('./DistNsuStatus');
const { normalizarNsuOuZero } = require('../../../services/fiscal/dfeRetornoParser');

function nsuBig(valor) {
  const n = normalizarNsuOuZero(valor).replace(/^0+(?=\d)/, '') || '0';
  return BigInt(n);
}

function formatNsu(n) {
  return String(n).padStart(15, '0');
}

/**
 * @param {Array<string|number>} nsusRecebidos — NSUs realmente recebidos no lote
 * @param {Object} [meta]
 * @returns {{ lacunas: Object[], status: string|null, resumo: string|null }}
 */
function detectarLacunasNsu(nsusRecebidos = [], meta = {}) {
  const unicos = [...new Set(
    (nsusRecebidos || [])
      .map((n) => normalizarNsuOuZero(n))
      .filter(Boolean)
  )].sort((a, b) => (nsuBig(a) < nsuBig(b) ? -1 : nsuBig(a) > nsuBig(b) ? 1 : 0));

  const lacunas = [];
  for (let i = 1; i < unicos.length; i += 1) {
    const prev = nsuBig(unicos[i - 1]);
    const curr = nsuBig(unicos[i]);
    const diff = curr - prev;
    if (diff > 1n) {
      lacunas.push({
        tipo: DistNsuStatus.LACUNA_DETECTADA,
        classificacao: DistNsuStatus.POSSIVEL_LACUNA_NSU,
        nsuAnterior: formatNsu(prev),
        nsuAtual: formatNsu(curr),
        intervalo: Number(diff - 1n),
        data: meta.data || new Date().toISOString(),
        cnpj: meta.cnpj || null,
        ambiente: meta.ambiente != null ? meta.ambiente : null,
        // Explicitamente: não listamos NSUs fabricados
        nsusFabricados: [],
        observacao: 'Lacuna aparente entre NSUs recebidos. Não implica documento perdido automaticamente.'
      });
    }
  }

  if (!lacunas.length) {
    return { lacunas: [], status: null, resumo: null };
  }

  return {
    lacunas,
    status: DistNsuStatus.POSSIVEL_LACUNA_NSU,
    resumo: `${lacunas.length} lacuna(s) aparente(s) detectada(s) — cursor não alterado`
  };
}

module.exports = {
  detectarLacunasNsu,
  nsuBig,
  formatNsu
};
