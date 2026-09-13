/**
 * Constantes públicas — saldos do Motor Fiscal × Não Fiscal.
 * @module services/fiscalNaoFiscal/constants
 */
'use strict';

const TipoSaldo = Object.freeze({
  FISCAL: 'FISCAL',
  NAO_FISCAL: 'NAO_FISCAL'
});

function normalizarTipoSaldo(tipo) {
  const raw = String(tipo || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  if (
    raw === 'FISCAL'
    || raw === 'F'
    || raw === 'SALDO_FISCAL'
  ) {
    return TipoSaldo.FISCAL;
  }

  if (
    raw === 'NAO_FISCAL'
    || raw === 'NAOFISCAL'
    || raw === 'NF'
    || raw === 'SALDO_NAO_FISCAL'
  ) {
    return TipoSaldo.NAO_FISCAL;
  }

  const err = new Error(`Tipo de saldo inválido: ${tipo}`);
  err.code = 'TIPO_SALDO_INVALIDO';
  throw err;
}

module.exports = {
  TipoSaldo,
  normalizarTipoSaldo
};
