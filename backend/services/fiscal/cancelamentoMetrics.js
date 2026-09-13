/**
 * Métricas do runtime de Cancelamento (RC1.1 — padrão unificado).
 * @module services/fiscal/cancelamentoMetrics
 */

const { FiscalRuntimeMetrics } = require('./core/FiscalRuntimeMetrics');

class CancelamentoMetrics extends FiscalRuntimeMetrics {
  constructor() {
    super({ quantityKey: 'quantidadeCancelamentos' });
  }
}

module.exports = {
  CancelamentoMetrics
};
