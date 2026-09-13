/**
 * MUC RC2 — Etapa 2: Validação
 * @module motores/muc/core/MotorValidacao
 */
'use strict';

function executar(ctx) {
  const warnings = [];
  const dto = ctx.dto;
  const item = dto.item || {};

  if (dto.quantidadeCompra < 0) {
    return { ok: false, erro: 'Quantidade de compra não pode ser negativa.', warnings };
  }

  const fracionado = Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
  const qtdEmb = Number(item.quantidade_embalagens || dto.quantidadeCompra || 0);
  const qtdPor = Number(item.quantidade_por_embalagem || dto.quantidadePorApresentacao || 0);

  if (!fracionado && qtdEmb > 0 && qtdPor <= 0) {
    warnings.push('Quantidade por apresentação não informada; usando fator 1.');
  }

  if (dto.valorTotalCompra < 0) {
    return { ok: false, erro: 'Valor total de compra inválido.', warnings };
  }

  return { ok: true, warnings };
}

module.exports = { executar };
