/**
 * MaquinaEstadosDocumento — Transições RC3.7.1.
 *
 * @module motores/central-entradas/core/MaquinaEstadosDocumento
 */

'use strict';

const {
  DocumentoFiscalStatus,
  isTerminal,
  normalizarStatus
} = require('./DocumentoFiscalStatus');

const S = DocumentoFiscalStatus;

const TRANSICOES_PERMITIDAS = Object.freeze({
  [S.NOVA]: [S.RESUMO_RECEBIDO, S.XML_COMPLETO, S.IMPORTADA, S.ERRO, S.CANCELADA, S.DENEGADA],
  [S.RESUMO_RECEBIDO]: [
    S.XML_COMPLETO,
    S.XML_INDISPONIVEL,
    S.CANCELADA,
    S.DENEGADA,
    S.INUTILIZADA,
    S.FINALIZADA
  ],
  [S.XML_INDISPONIVEL]: [
    S.RESUMO_RECEBIDO,
    S.XML_COMPLETO,
    S.CANCELADA,
    S.DENEGADA,
    S.INUTILIZADA,
    S.FINALIZADA
  ],
  [S.XML_COMPLETO]: [
    S.EM_REVISAO,
    S.PRONTA_IMPORTACAO,
    S.ERRO,
    S.CANCELADA,
    S.DENEGADA,
    S.FINALIZADA,
    S.IMPORTADA
  ],
  [S.EM_REVISAO]: [
    S.PRONTA_IMPORTACAO,
    S.ERRO,
    S.CANCELADA,
    S.DENEGADA,
    S.FINALIZADA
  ],
  [S.PRONTA_IMPORTACAO]: [
    S.EM_IMPORTACAO,
    S.CANCELADA,
    S.DENEGADA,
    S.FINALIZADA
  ],
  [S.EM_IMPORTACAO]: [
    S.IMPORTADA,
    S.PRONTA_IMPORTACAO,
    S.ERRO,
    S.CANCELADA
  ],
  [S.ERRO]: [S.XML_COMPLETO, S.RESUMO_RECEBIDO, S.CANCELADA, S.FINALIZADA],
  [S.IMPORTADA]: [S.FINALIZADA, S.CANCELADA],
  [S.FINALIZADA]: [],
  [S.CANCELADA]: [],
  [S.DENEGADA]: [],
  [S.INUTILIZADA]: []
});

const PARALELOS_FISCAIS = Object.freeze([
  S.CANCELADA,
  S.DENEGADA,
  S.INUTILIZADA
]);

/**
 * Aplicação de XML completo sobre resumo / XML indisponível.
 * @param {string} statusAtual
 * @param {string} statusNovo
 * @returns {boolean}
 */
function ehAplicacaoXmlCompleto(statusAtual, statusNovo) {
  const a = normalizarStatus(statusAtual);
  const n = normalizarStatus(statusNovo);
  return n === S.XML_COMPLETO
    && (a === S.RESUMO_RECEBIDO || a === S.XML_INDISPONIVEL);
}

/** @deprecated RC3.4.8 — use ehAplicacaoXmlCompleto / RESUMO_RECEBIDO */
function ehReaberturaXmlLegado(statusAtual, statusNovo) {
  const a = normalizarStatus(statusAtual);
  const n = normalizarStatus(statusNovo);
  return a === S.XML_INDISPONIVEL && n === S.RESUMO_RECEBIDO;
}

/** @deprecated RC3.4.9 — XML importado manualmente → XML_COMPLETO */
function ehImportacaoXmlManual(statusAtual, statusNovo) {
  return ehAplicacaoXmlCompleto(statusAtual, statusNovo);
}

function ehReaberturaTerminalXml(statusAtual, statusNovo) {
  return ehReaberturaXmlLegado(statusAtual, statusNovo)
    || ehAplicacaoXmlCompleto(statusAtual, statusNovo);
}

function ehTransicaoParalelaFiscal(statusAtual, statusNovo) {
  const a = normalizarStatus(statusAtual);
  const n = normalizarStatus(statusNovo);
  if (!PARALELOS_FISCAIS.includes(n)) return false;
  if (PARALELOS_FISCAIS.includes(a) || a === S.FINALIZADA) return false;
  return true;
}

/**
 * @param {string} statusAtual
 * @param {string} statusNovo
 * @returns {boolean}
 */
function podeTransicionar(statusAtual, statusNovo) {
  const a = normalizarStatus(statusAtual);
  const n = normalizarStatus(statusNovo);
  if (!a || !n) return false;
  if (a === n) return true;
  if (ehTransicaoParalelaFiscal(a, n)) return true;
  if (ehReaberturaTerminalXml(a, n)) return true;
  if (isTerminal(a) && !ehReaberturaTerminalXml(a, n) && !ehTransicaoParalelaFiscal(a, n)) {
    return false;
  }

  const permitidos = TRANSICOES_PERMITIDAS[a] || [];
  return permitidos.includes(n);
}

/**
 * @param {string} statusAtual
 * @param {string} statusNovo
 * @returns {{ valido: boolean, erro?: string }}
 */
function validarTransicao(statusAtual, statusNovo) {
  const a = normalizarStatus(statusAtual);
  const n = normalizarStatus(statusNovo);

  if (!a || !n) {
    return { valido: false, erro: 'Status atual e novo são obrigatórios' };
  }
  if (a === n) return { valido: true };

  if (ehTransicaoParalelaFiscal(a, n) || ehReaberturaTerminalXml(a, n)) {
    return { valido: true };
  }

  if (isTerminal(a)) {
    return { valido: false, erro: `Status terminal não permite transição: ${a}` };
  }

  if (!podeTransicionar(a, n)) {
    return { valido: false, erro: `Transição inválida: ${a} → ${n}` };
  }

  return { valido: true };
}

module.exports = {
  TRANSICOES_PERMITIDAS,
  ehAplicacaoXmlCompleto,
  ehReaberturaXmlLegado,
  ehImportacaoXmlManual,
  ehReaberturaTerminalXml,
  ehTransicaoParalelaFiscal,
  podeTransicionar,
  validarTransicao
};
