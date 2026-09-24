'use strict';

/**
 * Validação de limite de crédito no cadastro de cliente (Sprint 2C).
 * @module services/cadastro/limiteCreditoCliente
 */

function parseUtilizaLimiteCredito(valor) {
  if (valor === true || valor === 1 || valor === '1') return 1;
  if (typeof valor === 'string' && valor.trim().toLowerCase() === 'true') return 1;
  return 0;
}

/**
 * @param {object} body
 * @returns {{ ok: true, utiliza: 0|1, limite: number }
 *   | { ok: false, error: string, status: number }}
 */
function validarLimiteCreditoCadastro(body = {}) {
  const utiliza = parseUtilizaLimiteCredito(body.utiliza_limite_credito);

  if (!utiliza) {
    const bruto = body.limite_credito;
    if (bruto == null || String(bruto).trim() === '') {
      return { ok: true, utiliza: 0, limite: 0 };
    }
    const num = Number(bruto);
    if (!Number.isFinite(num) || num < 0) {
      return { ok: false, error: 'Limite de crédito inválido.', status: 400 };
    }
    return { ok: true, utiliza: 0, limite: num };
  }

  if (body.limite_credito == null || String(body.limite_credito).trim() === '') {
    return {
      ok: false,
      error: 'Limite de crédito é obrigatório quando "Utiliza limite de crédito" está marcado.',
      status: 400
    };
  }

  const num = Number(body.limite_credito);
  if (!Number.isFinite(num)) {
    return { ok: false, error: 'Limite de crédito inválido.', status: 400 };
  }
  if (num < 0) {
    return { ok: false, error: 'Limite de crédito deve ser maior ou igual a zero.', status: 400 };
  }

  return { ok: true, utiliza: 1, limite: num };
}

module.exports = {
  parseUtilizaLimiteCredito,
  validarLimiteCreditoCadastro
};
