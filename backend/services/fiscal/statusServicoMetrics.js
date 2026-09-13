/**
 * Métricas do runtime de Status do Serviço (RC1.1 — padrão unificado).
 * @module services/fiscal/statusServicoMetrics
 */

const { FiscalRuntimeMetrics } = require('./core/FiscalRuntimeMetrics');

class StatusServicoMetrics extends FiscalRuntimeMetrics {
  constructor() {
    super({ quantityKey: 'quantidadeStatus' });
  }
}

module.exports = {
  StatusServicoMetrics
};
