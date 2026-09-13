/**
 * Device Profile — Filizola Platina (scaffold SDK)
 * Gerado / mantido pelo Device Profile SDK (Sprint 15.7)
 */

'use strict';

module.exports = {
  id: 'filizola-platina',
  fabricante: 'Filizola',
  modelo: 'Platina',
  categoria: 'balanca',
  protocolo: 'filizola-platina',
  transportes: ['serial', 'ethernet'],
  versao: '1.0.0',
  prioridade: 50,
  discovery: {
    ports: [9100],
    timeout: 500
  },
  capabilities: {
    discovery: true,
    connection: true,
    identify: true,
    sync: true,
    diagnostics: true
  },
  driverModule: './FilizolaPlatinaDriver',
  status: 'estrutura',
  motorMinimo: '15.7.0',
  nomeExibicao: 'Filizola Platina'
};
