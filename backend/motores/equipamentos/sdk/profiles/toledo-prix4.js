/**
 * Sprint 15.7 — Device Profile: Toledo Prix IV Uno
 */

'use strict';

module.exports = {
  id: 'toledo-prix4',
  fabricante: 'Toledo',
  modelo: 'Prix IV Uno',
  categoria: 'balanca',
  protocolo: '90AX',
  protocolos: ['90AX', 'toledo-prix4', 'ethernet-tcp'],
  transportes: ['ethernet', 'serial'],
  versao: '2.0.0',
  prioridade: 10,
  discovery: {
    ports: [9000, 9100, 4001],
    timeout: 500
  },
  capabilities: {
    identify: true,
    sync: true,
    rollback: true,
    scheduler: true,
    telemetry: true,
    discovery: true,
    connection: true,
    diagnostics: true,
    update: false,
    backup: true
  },
  driverModule: 'toledo/prix4/ToledoPrix4UnoDriver',
  status: 'homologacao',
  motorMinimo: '15.7.0',
  nomeExibicao: 'Toledo Prix IV Uno',
  meta: {
    catalogoLegado: 'TOLEDO_PRIX4_UNO',
    fingerprintDriver: 'TOLEDO_PRIX4_UNO',
    runtimeModule: 'toledo/ToledoPrixIVDriver',
    codigoOficial: 'TOLEDO_PRIX4_UNO'
  }
};
