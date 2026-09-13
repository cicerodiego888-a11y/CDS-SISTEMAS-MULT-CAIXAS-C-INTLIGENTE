/**
 * Métricas do runtime de Consulta Protocolo (RC1.1 — padrão unificado).
 * @module services/fiscal/consultaProtocoloMetrics
 */

const { FiscalRuntimeMetrics } = require('./core/FiscalRuntimeMetrics');

class ConsultaProtocoloMetrics extends FiscalRuntimeMetrics {
  constructor() {
    super({ quantityKey: 'quantidadeConsultas' });
  }
}

module.exports = {
  ConsultaProtocoloMetrics
};
