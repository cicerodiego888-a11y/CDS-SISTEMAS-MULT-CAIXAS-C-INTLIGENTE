/**
 * MUC RC2 — Etapa 3: Normalização
 * @module motores/muc/core/MotorNormalizacao
 */
'use strict';

const { normalizarTipoApresentacao } = require('../constants/tiposApresentacao');
const { num } = require('../dto/ConversaoDTO');

function executar(ctx) {
  const dto = ctx.dto;
  return Object.freeze({
    ...ctx,
    dto: Object.freeze({
      ...dto,
      unidadeCompra: normalizarTipoApresentacao(dto.unidadeCompra),
      unidadeEstoque: String(dto.unidadeEstoque || 'un').toLowerCase(),
      quantidadeCompra: num(dto.quantidadeCompra, 4),
      quantidadePorApresentacao: num(dto.quantidadePorApresentacao, 4),
      valorTotalCompra: num(dto.valorTotalCompra, 2)
    })
  });
}

module.exports = { executar };
