/**
 * Métricas do runtime de Autorização NFC-e (RC1.1 — padrão unificado).
 * @module services/fiscal/autorizacaoMetrics
 */

const { FiscalRuntimeMetrics } = require('./core/FiscalRuntimeMetrics');

class AutorizacaoMetrics extends FiscalRuntimeMetrics {
  constructor() {
    super({ quantityKey: 'quantidadeAutorizacoes' });
  }
}

module.exports = {
  AutorizacaoMetrics
};
