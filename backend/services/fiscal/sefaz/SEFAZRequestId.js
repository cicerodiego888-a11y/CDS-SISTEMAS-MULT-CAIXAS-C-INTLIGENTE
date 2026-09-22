/**
 * Geração de request_id do SEFAZ Query Gate.
 */
'use strict';

let _seq = 0;

function criarRequestId(agora = new Date()) {
  _seq = (_seq + 1) % 1000000;
  const d = agora instanceof Date ? agora : new Date(agora);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const seq = String(_seq).padStart(6, '0');
  return `SEFAZ-${y}${m}${day}-${seq}`;
}

function _resetSeqForTests() {
  _seq = 0;
}

module.exports = {
  criarRequestId,
  _resetSeqForTests
};
