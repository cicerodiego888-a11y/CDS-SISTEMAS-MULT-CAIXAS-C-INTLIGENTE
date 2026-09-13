/**
 * Métricas do runtime de Distribuição DF-e (RC1.1 — padrão unificado).
 * @module services/fiscal/distribuicaoDfeMetrics
 */

const { FiscalRuntimeMetrics } = require('./core/FiscalRuntimeMetrics');

class DistribuicaoDfeMetrics extends FiscalRuntimeMetrics {
  constructor() {
    super({ quantityKey: 'quantidadeDfe' });
  }
}

module.exports = {
  DistribuicaoDfeMetrics
};
