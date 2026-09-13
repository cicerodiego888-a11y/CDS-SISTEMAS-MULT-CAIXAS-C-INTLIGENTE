/**
 * MUC RC2 — ResultadoConversaoDTO (contrato público único e imutável)
 * @module motores/muc/dto/ResultadoConversaoDTO
 */
'use strict';

const crypto = require('crypto');
const VERSAO = require('../version');

function num(v, casas = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** casas) / 10 ** casas;
}

function gerarHash(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 16);
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach((key) => {
      deepFreeze(obj[key]);
    });
  }
  return obj;
}

/**
 * Contrato público oficial — nenhum módulo externo deve consumir objetos internos do pipeline.
 * @param {Object} dados
 * @returns {Readonly<Object>}
 */
function criarResultadoConversaoDTO(dados = {}) {
  const hashPayload = {
    produtoId: dados.produtoId ?? null,
    apresentacaoId: dados.apresentacaoId ?? null,
    quantidadeCompra: num(dados.quantidadeCompra, 4),
    fatorConversao: num(dados.fatorConversao, 4),
    quantidadeEstoque: num(dados.quantidadeEstoque, 4),
    tipoConversao: String(dados.tipoConversao || 'UNIDADE'),
    versaoMotor: dados.versaoMotor || VERSAO.VERSAO_MOTOR,
    versaoRegra: dados.versaoRegra || '1.0.0'
  };
  const hashConversao = gerarHash(hashPayload);
  const warnings = Object.freeze([...(Array.isArray(dados.warnings) ? dados.warnings : [])]);
  const metadata = deepFreeze(
    dados.metadata && typeof dados.metadata === 'object'
      ? { ...dados.metadata }
      : {}
  );

  const base = {
    // RC1 — campos funcionais (preservados)
    produtoId: dados.produtoId ?? null,
    apresentacaoId: dados.apresentacaoId ?? null,
    origem: String(dados.origem || 'MANUAL'),
    quantidadeCompra: num(dados.quantidadeCompra, 4),
    unidadeCompra: String(dados.unidadeCompra || 'UN'),
    fatorConversao: num(dados.fatorConversao, 4),
    quantidadeEstoque: num(dados.quantidadeEstoque, 4),
    quantidadeFiscal: num(dados.quantidadeFiscal, 4),
    quantidadeNaoFiscal: num(dados.quantidadeNaoFiscal, 4),
    unidadeEstoque: String(dados.unidadeEstoque || 'un'),
    custoUnitario: num(dados.custoUnitario, 4),
    custoTotal: num(dados.custoTotal, 2),
    tipoConversao: String(dados.tipoConversao || 'UNIDADE'),
    confianca: num(dados.confianca, 2),
    metodoInferencia: String(dados.metodoInferencia || 'DIRETO'),
    subtotal: num(dados.subtotal, 2),
    timestamp: dados.timestamp || new Date().toISOString(),
    // RC2 — metadados oficiais
    versaoMotor: dados.versaoMotor || VERSAO.VERSAO_MOTOR,
    versaoRegra: dados.versaoRegra || '1.0.0',
    regraAplicada: dados.regraAplicada || null,
    origemDados: dados.origemDados || 'API',
    tempoProcessamentoMs: num(dados.tempoProcessamentoMs, 2),
    warnings,
    metadata,
    hashConversao,
    correlationId: dados.correlationId || null,
    // RC1 compat
    hash: hashConversao
  };

  return Object.freeze(base);
}

function resultadoParaJson(resultado) {
  if (!resultado) return null;
  return JSON.stringify(resultado);
}

function resultadoFromJson(json) {
  if (!json) return null;
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    return criarResultadoConversaoDTO(parsed);
  } catch {
    return null;
  }
}

module.exports = {
  criarResultadoConversaoDTO,
  resultadoParaJson,
  resultadoFromJson,
  gerarHash,
  num
};
