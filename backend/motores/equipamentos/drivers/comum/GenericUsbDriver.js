'use strict';

/**
 * Driver genérico USB — captura dispositivos USB enumerados (RC2).
 */
const createBalancaDriver = require('./createBalancaDriver');

module.exports = createBalancaDriver({
  codigo: 'GENERIC_USB',
  fabricante: 'Genérico',
  modelo: 'USB',
  transportes: ['usb'],
  protocolos: ['usb-generico'],
  keywords: [],
  aceitarGenerico: true
});
