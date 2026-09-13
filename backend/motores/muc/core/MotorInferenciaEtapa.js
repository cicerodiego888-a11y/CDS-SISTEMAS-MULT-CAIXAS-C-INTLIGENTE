/**
 * MUC RC2 — Etapa 4: Inferência (wrapper SRP)
 * @module motores/muc/core/MotorInferenciaEtapa
 */
'use strict';

const { inferirConversao } = require('./MotorInferencia');

function executar(ctx) {
  const inferido = inferirConversao({
    ...ctx.dto,
    apresentacao: ctx.apresentacao,
    produto: ctx.input.produto
  });
  return Object.freeze({ ...ctx, inferido });
}

module.exports = { executar };
