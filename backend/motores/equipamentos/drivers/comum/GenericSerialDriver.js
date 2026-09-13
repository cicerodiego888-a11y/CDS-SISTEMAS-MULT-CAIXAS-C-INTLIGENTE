'use strict';

/**
 * Driver genérico Serial — captura portas sem match de fabricante (RC2).
 */
const createBalancaDriver = require('./createBalancaDriver');

module.exports = createBalancaDriver({
  codigo: 'GENERIC_SERIAL',
  fabricante: 'Genérico',
  modelo: 'Serial',
  transportes: ['serial'],
  protocolos: ['serial-generico'],
  keywords: [],
  aceitarGenerico: true
});
