/**
 * MUC RC2 — Etapa 6: Auditoria (registro em memória / preparo DB)
 * @module motores/muc/core/MotorAuditoriaEtapa
 */
'use strict';

function executar(ctx, opcoes = {}) {
  const auditavel = Object.freeze({
    resultado: ctx.resultado,
    contexto: Object.freeze({
      gtin: opcoes.gtin ?? ctx.dto?.gtin,
      fornecedorCnpj: opcoes.fornecedorCnpj ?? ctx.dto?.fornecedorCnpj,
      codigoFornecedor: opcoes.codigoFornecedor ?? ctx.dto?.codigoFornecedor,
      descricao: opcoes.descricao ?? ctx.dto?.descricao,
      usuarioId: opcoes.usuarioId,
      usuarioNome: opcoes.usuarioNome,
      motivo: opcoes.motivo,
      xml: opcoes.xml ?? null,
      regraAplicada: ctx.resultado?.regraAplicada,
      versaoRegra: ctx.resultado?.versaoRegra,
      versaoMotor: ctx.resultado?.versaoMotor,
      correlationId: ctx.resultado?.correlationId,
      tempoProcessamentoMs: ctx.resultado?.tempoProcessamentoMs
    })
  });
  return Object.freeze({ ...ctx, auditavel });
}

module.exports = { executar };
