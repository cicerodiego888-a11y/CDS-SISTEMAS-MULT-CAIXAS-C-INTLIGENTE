/**
 * Adaptador temporário — compatibilidade com callers legados.
 * A implementação oficial vive no MIDP (Sprint 3.8A).
 *
 * @deprecated Preferir require('./midp').executar(...)
 */

'use strict';

const midp = require('./midp');

function distribuirPagamentos(pagamentos = [], totalFiscal = 0, totalNaoFiscal = 0) {
  return midp.distribuirPagamentos(pagamentos, totalFiscal, totalNaoFiscal);
}

module.exports = {
  distribuirPagamentos
};
