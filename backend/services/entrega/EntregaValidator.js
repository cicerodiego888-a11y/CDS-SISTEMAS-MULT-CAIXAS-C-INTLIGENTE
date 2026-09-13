/**
 * EntregaValidator — Sprint 2.1
 */

const {
  TIPOS_VENDA,
  PAGAMENTOS_PREVISTOS,
  normalizarStatusEntrega,
  normalizarStatusVenda
} = require('./enums');

class EntregaValidator {
  validarTipoVenda(valor) {
    const v = String(valor || '').toUpperCase();
    return TIPOS_VENDA.includes(v);
  }

  validarStatusEntrega(valor) {
    return normalizarStatusEntrega(valor) != null;
  }

  validarStatusVenda(valor) {
    return normalizarStatusVenda(valor) != null;
  }

  validarPagamentoPrevisto(valor) {
    const v = String(valor || '').toUpperCase();
    return PAGAMENTOS_PREVISTOS.includes(v);
  }

  validarPayloadEntrega(_payload = {}) {
    return { valid: true, errors: [] };
  }
}

module.exports = {
  EntregaValidator,
  entregaValidator: new EntregaValidator()
};
