/**
 * SimilarityWeights — Carregador de pesos configuráveis de similaridade.
 *
 * Sprint 10 — Hybrid Similarity Engine v1.
 *
 * @module motores/miip/utils/SimilarityWeights
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_WEIGHTS_PATH = path.join(__dirname, '../config/similarity-weights.json');

const PESOS_PADRAO = Object.freeze({
  marca: 25,
  tipo: 20,
  tecnologia: 20,
  potencia: 20,
  modelo: 15,
  unidadeMedida: 5,
  embalagem: 5,
  quantidadeEmbalagem: 5,
  material: 5,
  cor: 5
});

const CONFIANCA_PADRAO = Object.freeze({
  alta: 85,
  media: 60,
  baixa: 30
});

/** @type {Object|null} */
let _cache = null;

/**
 * @param {string} [caminho]
 * @returns {Object}
 */
function carregar(caminho = DEFAULT_WEIGHTS_PATH) {
  if (_cache && caminho === DEFAULT_WEIGHTS_PATH) {
    return _cache;
  }

  try {
    const json = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    const config = {
      versao: json.versao ?? '1.0.0',
      pesos: { ...PESOS_PADRAO, ...(json.pesos ?? {}) },
      confianca: { ...CONFIANCA_PADRAO, ...(json.confianca ?? {}) }
    };

    if (caminho === DEFAULT_WEIGHTS_PATH) {
      _cache = config;
    }

    return config;
  } catch {
    return {
      versao: '1.0.0',
      pesos: { ...PESOS_PADRAO },
      confianca: { ...CONFIANCA_PADRAO }
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
 * @returns {string[]}
 */
function listarAtributos() {
  return Object.keys(carregar().pesos);
}

module.exports = {
  carregar,
  reiniciarCache,
  listarAtributos,
  PESOS_PADRAO,
  CONFIANCA_PADRAO,
  DEFAULT_WEIGHTS_PATH
};
