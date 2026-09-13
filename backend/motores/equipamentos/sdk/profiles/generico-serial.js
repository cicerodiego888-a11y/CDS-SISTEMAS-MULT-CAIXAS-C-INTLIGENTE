/**
 * Sprint 15.7 — Device Profile stub: Genérico Serial (exemplo SDK)
 */

'use strict';

module.exports = {
  id: 'generico-serial',
  fabricante: 'Genérico',
  modelo: 'Serial',
  categoria: 'balanca',
  protocolo: 'serial-generico',
  transportes: ['serial'],
  versao: '1.0.0',
  prioridade: 900,
  discovery: {
    ports: [],
    timeout: 800
  },
  capabilities: {
    discovery: true,
    connection: true,
    identify: true,
    sync: false,
    telemetry: false,
    diagnostics: true
  },
  driverModule: 'comum/GenericSerialDriver',
  status: 'estrutura',
  motorMinimo: '15.7.0',
  nomeExibicao: 'Genérico Serial'
};
