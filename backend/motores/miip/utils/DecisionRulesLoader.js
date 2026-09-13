/**
 * DecisionRulesLoader — Carregador de regras do Decision Engine.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @module motores/miip/utils/DecisionRulesLoader
 */

const path = require('path');
const fs = require('fs');
const DecisionRule = require('../core/DecisionRule');

const DEFAULT_RULES_PATH = path.join(__dirname, '../config/decision-rules.json');

const THRESHOLDS_PADRAO = Object.freeze({
  sugerirConfirmacao: 95,
  mostrarSugestoes: 80,
  gapMinimoConfirmacao: 15
});

const MOTORES_AUTO_PADRAO = Object.freeze([
  'motor_gtin',
  'motor_associacao_fornecedor'
]);

/** @type {Object|null} */
let _cache = null;

/**
 * @param {string} [caminho]
 * @returns {Object}
 */
function carregar(caminho = DEFAULT_RULES_PATH) {
  if (_cache && caminho === DEFAULT_RULES_PATH) {
    return _cache;
  }

  try {
    const json = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    const regras = (json.regras ?? [])
      .map((regra) => DecisionRule.create(regra))
      .sort((a, b) => a.prioridade - b.prioridade);

    const config = {
      versao: json.versao ?? '1.0.0',
      descricao: json.descricao ?? '',
      thresholds: { ...THRESHOLDS_PADRAO, ...(json.thresholds ?? {}) },
      motoresAutoAssociar: json.motoresAutoAssociar ?? [...MOTORES_AUTO_PADRAO],
      regras
    };

    if (caminho === DEFAULT_RULES_PATH) {
      _cache = config;
    }

    return config;
  } catch {
    return {
      versao: '1.0.0',
      descricao: 'Regras padrão',
      thresholds: { ...THRESHOLDS_PADRAO },
      motoresAutoAssociar: [...MOTORES_AUTO_PADRAO],
      regras: []
    };
  }
}

/**
 * @returns {void}
 */
function reiniciarCache() {
  _cache = null;
}

/**
 * @returns {DecisionRule[]}
 */
function listarRegrasAtivas() {
  return carregar().regras.filter((regra) => regra.ativo);
}

module.exports = {
  carregar,
  reiniciarCache,
  listarRegrasAtivas,
  THRESHOLDS_PADRAO,
  MOTORES_AUTO_PADRAO,
  DEFAULT_RULES_PATH
};
