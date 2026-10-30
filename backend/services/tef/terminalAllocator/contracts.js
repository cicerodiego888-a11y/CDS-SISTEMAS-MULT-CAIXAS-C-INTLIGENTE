'use strict';

/**
 * MRT-04 — Contrato de alocação / isolamento de terminais TEF.
 *
 * Lease de ocupação ≠ lock financeiro (TEF-13/14). Timeout de ocupação
 * NÃO libera resultado financeiro inconclusivo.
 */

const ALLOCATION_CODES = Object.freeze({
  ALLOCATED: 'ALLOCATED',
  TERMINAL_OCUPADO: 'TERMINAL_OCUPADO',
  RUNTIME_OCUPADO: 'RUNTIME_OCUPADO',
  TERMINAL_AUSENTE: 'TERMINAL_AUSENTE',
  ALOCACAO_AMBÍGUA: 'ALOCACAO_AMBIGUA',
  LEASE_NAO_ENCONTRADO: 'LEASE_NAO_ENCONTRADO',
  LEASE_JA_LIBERADO: 'LEASE_JA_LIBERADO',
  LIBERACAO_BLOQUEADA_INCONCLUSIVA: 'LIBERACAO_BLOQUEADA_INCONCLUSIVA',
  AQUISICAO_FALHOU: 'AQUISICAO_FALHOU',
  PARAMETRO_INVALIDO: 'PARAMETRO_INVALIDO'
});

const RELEASE_REASONS = Object.freeze({
  SUCESSO_CONFIRMADO: 'SUCESSO_CONFIRMADO',
  FALHA_CONFIRMADA: 'FALHA_CONFIRMADA',
  CANCELADO_OPERADOR: 'CANCELADO_OPERADOR',
  TIMEOUT_OCUPACAO: 'TIMEOUT_OCUPACAO',
  RECUPERACAO_REINICIO: 'RECUPERACAO_REINICIO',
  FORCAR_ADMIN: 'FORCAR_ADMIN'
});

/** Motivos que permitem liberar o lease de terminal. */
const RELEASE_PERMITIDOS = new Set([
  RELEASE_REASONS.SUCESSO_CONFIRMADO,
  RELEASE_REASONS.FALHA_CONFIRMADA,
  RELEASE_REASONS.CANCELADO_OPERADOR,
  RELEASE_REASONS.RECUPERACAO_REINICIO,
  RELEASE_REASONS.FORCAR_ADMIN
]);

/**
 * Isolamento por provedor/runtime.
 * Destaxa: serialização global enquanto Native Host / V$Pague forem singleton.
 */
const ISOLATION_POLICIES = Object.freeze({
  destaxa: Object.freeze({
    provedor: 'destaxa',
    modo: 'GLOBAL_SERIALIZE',
    runtimeKey: 'runtime:destaxa:global',
    permiteTerminaisParalelos: false,
    motivo: 'Native Host singleton + V$Pague hostname/MAC; multi-terminal não documentado'
  }),
  sitef: Object.freeze({
    provedor: 'sitef',
    modo: 'PER_TERMINAL',
    runtimeKey: null,
    permiteTerminaisParalelos: true,
    motivo: 'Isolamento por terminal lógico até evidência contrária do SDK'
  }),
  paygo: Object.freeze({
    provedor: 'paygo',
    modo: 'PER_TERMINAL',
    runtimeKey: null,
    permiteTerminaisParalelos: true,
    motivo: 'Isolamento por terminal lógico até evidência contrária do SDK'
  }),
  default: Object.freeze({
    provedor: 'default',
    modo: 'PER_TERMINAL',
    runtimeKey: null,
    permiteTerminaisParalelos: true,
    motivo: 'Política conservadora por terminal'
  })
});

function politicaIsolamento(provedor) {
  const p = String(provedor || '').toLowerCase();
  return ISOLATION_POLICIES[p] || ISOLATION_POLICIES.default;
}

function criarLease(parcial = {}) {
  return {
    leaseId: String(parcial.leaseId),
    terminalTefId: parcial.terminalTefId != null ? String(parcial.terminalTefId) : null,
    runtimeKey: parcial.runtimeKey != null ? String(parcial.runtimeKey) : null,
    pdvId: parcial.pdvId != null ? String(parcial.pdvId) : null,
    provedor: parcial.provedor ? String(parcial.provedor).toLowerCase() : null,
    adquiridoEm: parcial.adquiridoEm || new Date().toISOString(),
    expiraEm: parcial.expiraEm || null,
    ocupacaoTimeoutMs: parcial.ocupacaoTimeoutMs || null,
    resultadoFinanceiroInconclusivo: parcial.resultadoFinanceiroInconclusivo === true,
    liberado: parcial.liberado === true,
    liberadoEm: parcial.liberadoEm || null,
    motivoLiberacao: parcial.motivoLiberacao || null,
    meta: parcial.meta || null
  };
}

module.exports = {
  ALLOCATION_CODES,
  RELEASE_REASONS,
  RELEASE_PERMITIDOS,
  ISOLATION_POLICIES,
  politicaIsolamento,
  criarLease
};
