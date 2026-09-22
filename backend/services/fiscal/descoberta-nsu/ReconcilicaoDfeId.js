/**
 * Identificadores de reconciliação (Sprint 4).
 * @module services/fiscal/descoberta-nsu/ReconcilicaoDfeId
 */
'use strict';

let _seq = 0;

/**
 * @param {Date} [agora]
 * @returns {string} RECON-YYYYMMDD-000001
 */
function criarReconciliationId(agora = new Date()) {
  _seq = (_seq + 1) % 1000000;
  const d = agora instanceof Date ? agora : new Date();
  const p = (n, s = 2) => String(n).padStart(s, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return `RECON-${stamp}-${String(_seq).padStart(6, '0')}`;
}

/** Reset de sequência — somente testes. */
function _resetSeqParaTestes() {
  _seq = 0;
}

module.exports = {
  criarReconciliationId,
  _resetSeqParaTestes
};
