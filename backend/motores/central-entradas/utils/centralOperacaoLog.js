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

function sanitizarCampoLog(chave, valor) {
  const nome = String(chave || '').toLowerCase();
  if (/senha|password|private.?key|certificado.*(path|senha|conteudo)|\bpfx\b|\bp12\b/.test(nome)) {
    return '[REDACTED]';
  }
  if (valor == null) return valor;
  if (Array.isArray(valor)) return valor.map((item) => sanitizarCampoLog(chave, item));
  if (typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([subChave, subValor]) => [
        subChave,
        sanitizarCampoLog(subChave, subValor)
      ])
    );
  }

  const digitos = String(valor).replace(/\D/g, '');
  if ((nome.includes('cnpj') || nome === 'empresa') && digitos.length >= 11) {
    return `***${digitos.slice(-4)}`;
  }
  if ((nome.includes('chave') || nome.includes('chnfe')) && digitos.length >= 4) {
    return `…${digitos.slice(-4)}`;
  }
  if (nome.includes('nsu') && digitos.length >= 4) {
    return `…${digitos.slice(-4)}`;
  }
  if (typeof valor !== 'string') return valor;
  return valor
    .replace(/\b\d{44}\b/g, (chave) => `…${chave.slice(-4)}`)
    .replace(/\b\d{15}\b/g, (nsu) => `…${nsu.slice(-4)}`)
    .replace(/\b\d{14}\b/g, (cnpj) => `***${cnpj.slice(-4)}`);
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

  logCentral(dados.area || 'OPERACAO', sanitizarCampoLog('', limpos));
}

module.exports = {
  criarCorrelationId,
  logOperacaoCentral
};
