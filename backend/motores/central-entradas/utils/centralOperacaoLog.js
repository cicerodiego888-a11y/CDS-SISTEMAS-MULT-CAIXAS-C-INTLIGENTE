/**
 * Log operacional unificado da Central (RC3.3.3).
 *
 * Campos obrigatórios por operação:
 * CorrelationId | Chave | NSU | Operação | Tempo | Resultado | cStat | Origem | Runtime
 *
 * @module motores/central-entradas/utils/centralOperacaoLog
 */

const { logCentral } = require('./centralLog');
const crypto = require('crypto');

/**
 * @returns {string}
 */
function criarCorrelationId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `central-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * @param {Object} dados
 */
function logOperacaoCentral(dados = {}) {
  const fields = {
    CorrelationId: dados.correlationId || dados.CorrelationId || null,
    Chave: dados.chave || dados.Chave || null,
    NSU: dados.nsu || dados.NSU || dados.ultNsu || null,
    Operação: dados.operacao || dados.Operacao || null,
    Tempo: dados.tempoMs != null ? dados.tempoMs : (dados.Tempo != null ? dados.Tempo : null),
    Resultado: dados.resultado || dados.Resultado || null,
    cStat: dados.cStat != null ? dados.cStat : null,
    Origem: dados.origem || dados.Origem || null,
    Runtime: dados.runtime || dados.Runtime || null
  };

  if (dados.detalhe && typeof dados.detalhe === 'object') {
    Object.assign(fields, dados.detalhe);
  }

  // Remove vazios para não poluir, mantendo o contrato dos campos principais.
  const limpos = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined && v !== '') limpos[k] = v;
  }

  logCentral(dados.area || 'OPERACAO', limpos);
}

module.exports = {
  criarCorrelationId,
  logOperacaoCentral
};
