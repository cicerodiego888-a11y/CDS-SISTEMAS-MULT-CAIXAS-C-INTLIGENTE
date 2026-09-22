/**
 * Avaliação read-only das proteções SEFAZ (Sprint 5).
 * Não altera Gate / Rate / Cooldown / CB / Lock — apenas consulta estado.
 */
'use strict';

/**
 * @param {Object} [params]
 * @param {string} [params.cnpj]
 * @param {number} [params.ambiente]
 * @param {string} [params.tipo]
 * @returns {Promise<Object>}
 */
async function avaliarProtecoesOperacionais(params = {}) {
  const cnpj = params.cnpj ? String(params.cnpj).replace(/\D/g, '') : null;
  const ambiente = params.ambiente != null ? (Number(params.ambiente) === 1 ? 1 : 2) : null;
  const tipo = params.tipo || 'distNSU';
  const out = {
    cooldown: false,
    circuitOpen: false,
    rateLimited: false,
    lockAtivo: false,
    motivo: null
  };

  if (!cnpj || ambiente == null) return out;

  try {
    const { obterDistNsuSyncLock } = require('../../../motores/central-entradas/descoberta-nsu/DistNsuSyncLock');
    if (obterDistNsuSyncLock().estaExecutando(cnpj, ambiente)) {
      out.lockAtivo = true;
      out.motivo = 'DistNsuSyncLock ativo para CNPJ+ambiente';
      return out;
    }
  } catch { /* ignore */ }

  try {
    const gate = require('../sefaz/SEFAZQueryGate');
    const diag = typeof gate.obterDiagnostico === 'function'
      ? gate.obterDiagnostico(cnpj, ambiente)
      : null;
    if (diag?.cooldown?.ativo) {
      out.cooldown = true;
      out.motivo = diag.cooldown.motivo || 'Cooldown SEFAZ ativo';
      return out;
    }
    if (diag?.circuit_breaker?.state === 'OPEN' || diag?.circuit_breaker?.estado === 'OPEN') {
      out.circuitOpen = true;
      out.motivo = 'Circuit Breaker OPEN';
      return out;
    }
    if (gate._rate && typeof gate._rate.quandoConsultar === 'function') {
      const rl = gate._rate.quandoConsultar(cnpj, ambiente, tipo);
      if (rl && rl.permitido === false) {
        out.rateLimited = true;
        out.motivo = rl.motivo || 'Rate limit ativo';
        return out;
      }
    }
  } catch { /* ignore */ }

  return out;
}

module.exports = { avaliarProtecoesOperacionais };
