'use strict';

const SimulatedGatewayAdapter = require('./SimulatedGatewayAdapter');

/**
 * Adapter Destaxa em SIMULACAO.
 * Não carrega DLL nativa — reutiliza o gateway simulado existente.
 */
function DestaxaAdapter(config) {
  return new SimulatedGatewayAdapter(config, {
    nome: 'Destaxa',
    adquirente: 'DESTAXA',
    bandeiraPadrao: 'VISA'
  });
}

module.exports = DestaxaAdapter;
