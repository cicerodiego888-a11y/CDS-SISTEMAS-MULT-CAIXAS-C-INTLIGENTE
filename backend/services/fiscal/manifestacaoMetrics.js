/**
 * Métricas do runtime de Manifestação (RC1.1 — padrão unificado).
 * @module services/fiscal/manifestacaoMetrics
 */

const { FiscalRuntimeMetrics } = require('./core/FiscalRuntimeMetrics');

class ManifestacaoMetrics extends FiscalRuntimeMetrics {
  constructor() {
    super({ quantityKey: 'quantidadeManifestacoes' });
  }
}

module.exports = {
  ManifestacaoMetrics
};
