'use strict';

/**
 * MRT-07 — Contratos de monitoramento e recuperação de terminais TEF.
 *
 * Estados de ocupação/monitoramento ≠ estados financeiros TEF-14.
 * Recuperação NUNCA aprova, cancela ou repete pagamento automaticamente.
 */

const MONITOR_STATES = Object.freeze({
  LIVRE: 'LIVRE',
  OCUPADO: 'OCUPADO',
  INCONCLUSIVO: 'INCONCLUSIVO',
  INDISPONIVEL: 'INDISPONIVEL',
  EM_RECUPERACAO: 'EM_RECUPERACAO',
  DESCONHECIDO: 'DESCONHECIDO'
});

const RECOVERY_CODES = Object.freeze({
  RECUPERACAO_OK: 'RECUPERACAO_OK',
  RECUPERACAO_DUPLICADA: 'RECUPERACAO_DUPLICADA',
  HOLDS_APLICADOS: 'HOLDS_APLICADOS',
  SEM_PENDENCIAS: 'SEM_PENDENCIAS',
  MONITOR_OK: 'MONITOR_OK',
  RECUPERACAO_ERRO: 'RECUPERACAO_ERRO'
});

/** Ações explicitamente proibidas na recuperação automática. */
const ACOES_PROIBIDAS = Object.freeze([
  'APROVAR_PAGAMENTO',
  'CANCELAR_PAGAMENTO',
  'REPETIR_AUTORIZACAO',
  'LIBERAR_INCONCLUSIVO_FINANCEIRO',
  'PRESUMIR_CANCELAMENTO_POR_TIMEOUT'
]);

function criarSnapshotMonitor(parcial = {}) {
  return {
    terminalTefId: parcial.terminalTefId != null ? String(parcial.terminalTefId) : null,
    pdvId: parcial.pdvId != null ? String(parcial.pdvId) : null,
    provedor: parcial.provedor || null,
    runtimeKey: parcial.runtimeKey || null,
    estadoMonitor: parcial.estadoMonitor || MONITOR_STATES.DESCONHECIDO,
    estadoRegistry: parcial.estadoRegistry || null,
    leaseId: parcial.leaseId || null,
    leaseInconclusivo: parcial.leaseInconclusivo === true,
    holdRecuperacao: parcial.holdRecuperacao === true,
    transacaoIdPendente: parcial.transacaoIdPendente != null
      ? String(parcial.transacaoIdPendente)
      : null,
    vendaId: parcial.vendaId != null ? String(parcial.vendaId) : null,
    semVendaVinculada: parcial.semVendaVinculada === true,
    semLease: parcial.semLease === true,
    semResultadoDefinitivo: parcial.semResultadoDefinitivo === true,
    resultadoTardio: parcial.resultadoTardio === true,
    mensagem: parcial.mensagem || '',
    meta: parcial.meta || null
  };
}

module.exports = {
  MONITOR_STATES,
  RECOVERY_CODES,
  ACOES_PROIBIDAS,
  criarSnapshotMonitor
};
