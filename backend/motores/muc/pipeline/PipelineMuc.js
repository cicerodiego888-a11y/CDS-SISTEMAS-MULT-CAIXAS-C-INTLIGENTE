/**
 * MUC RC2 — Pipeline oficial de conversão
 * Parser → Validação → Normalização → Inferência → Conversão → Auditoria → DTO
 * @module motores/muc/pipeline/PipelineMuc
 */
'use strict';

const MotorParser = require('../core/MotorParser');
const MotorValidacao = require('../core/MotorValidacao');
const MotorNormalizacao = require('../core/MotorNormalizacao');
const MotorInferenciaEtapa = require('../core/MotorInferenciaEtapa');
const MotorConversaoCalculo = require('../core/MotorConversaoCalculo');
const MotorAuditoriaEtapa = require('../core/MotorAuditoriaEtapa');
const { criarResultadoConversaoDTO } = require('../dto/ResultadoConversaoDTO');
const { resolverRegra } = require('../constants/catalogoRegras');
const { gerarCorrelationId, registrar: registrarEvento } = require('../eventos/BarramentoEventos');
const MucMetricas = require('../observabilidade/MucMetricas');
const VERSAO = require('../version');

function executar(input = {}, opcoes = {}) {
  const t0 = typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
  const correlationId = opcoes.correlationId || gerarCorrelationId();
  const warnings = [];

  try {
    let ctx = MotorParser.executar(input);
    ctx = { ...ctx, correlationId };

    const validacao = MotorValidacao.executar(ctx);
    if (!validacao.ok) {
      registrarEvento('MUC_INFERENCIA_FALHOU', { erro: validacao.erro }, correlationId);
      MucMetricas.registrarErro(new Error(validacao.erro));
      throw new Error(validacao.erro);
    }
    warnings.push(...(validacao.warnings || []));

    ctx = MotorNormalizacao.executar(ctx);
    ctx = MotorInferenciaEtapa.executar(ctx);
    ctx = MotorConversaoCalculo.executar(ctx);

    const regra = resolverRegra(ctx.inferido.tipoConversao);
    const tempoProcessamentoMs = Math.round(
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 100
    ) / 100;

    const resultado = criarResultadoConversaoDTO({
      ...ctx.calculado,
      versaoMotor: VERSAO.VERSAO_MOTOR,
      versaoRegra: regra.versaoRegra,
      regraAplicada: regra.regraAplicada,
      origemDados: ctx.origemDados,
      tempoProcessamentoMs,
      warnings,
      metadata: Object.freeze({
        regraId: regra.id,
        dataRegra: regra.dataRegra,
        motivoRegra: regra.motivo
      }),
      correlationId
    });

    ctx = { ...ctx, resultado };
    ctx = MotorAuditoriaEtapa.executar(ctx, opcoes);

    const tipoEvento = String(input.origem || ctx.dto?.origem || '').toUpperCase() === 'MANUAL'
      ? 'MUC_CONVERSAO_MANUAL'
      : 'MUC_CONVERSAO_EXECUTADA';

    registrarEvento(tipoEvento, {
      produtoId: resultado.produtoId,
      apresentacaoId: resultado.apresentacaoId,
      tipoConversao: resultado.tipoConversao,
      quantidadeEstoque: resultado.quantidadeEstoque,
      confianca: resultado.confianca
    }, correlationId);

    MucMetricas.registrarConversao(resultado, {
      fornecedorCnpj: opcoes.fornecedorCnpj,
      gtin: opcoes.gtin || input.gtin
    });

    return resultado;
  } catch (err) {
    registrarEvento('MUC_ERRO', { message: err.message }, correlationId);
    MucMetricas.registrarErro(err);
    throw err;
  }
}

module.exports = { executar };
