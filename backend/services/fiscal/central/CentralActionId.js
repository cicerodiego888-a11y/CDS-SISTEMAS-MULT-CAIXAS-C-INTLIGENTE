/**
 * IDs de ação operacional (Sprint 5).
 * @module services/fiscal/central/CentralActionId
 */
'use strict';

let _seq = 0;

function criarActionId(agora = new Date()) {
  _seq = (_seq + 1) % 1000000;
  const d = agora instanceof Date ? agora : new Date();
  const p = (n, s = 2) => String(n).padStart(s, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return `ACTION-${stamp}-${String(_seq).padStart(6, '0')}`;
}

function _resetSeqParaTestes() {
  _seq = 0;
}

module.exports = { criarActionId, _resetSeqParaTestes };
