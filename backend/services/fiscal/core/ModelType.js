/**
 * Modelos documentais fiscais suportados pela plataforma.
 *
 * Sprint F1 — fundação. Ainda não utilizado em runtime.
 *
 * @module services/fiscal/core/ModelType
 */

const ModelType = Object.freeze({
  NFE: 'NFE',
  NFCE: 'NFCE',
  CTE: 'CTE',
  MDFE: 'MDFE'
});

/**
 * Código numérico do modelo fiscal (quando aplicável).
 * @type {Readonly<Record<string, string>>}
 */
const ModelCode = Object.freeze({
  [ModelType.NFE]: '55',
  [ModelType.NFCE]: '65',
  [ModelType.CTE]: '57',
  [ModelType.MDFE]: '58'
});

/**
 * @param {string} value
 * @returns {boolean}
 */
function isModelType(value) {
  return Object.prototype.hasOwnProperty.call(ModelType, value);
}

/**
 * @returns {string[]}
 */
function listModelTypes() {
  return Object.values(ModelType);
}

/**
 * @param {string} modelType
 * @returns {string|null}
 */
function getModelCode(modelType) {
  return ModelCode[modelType] || null;
}

module.exports = {
  ModelType,
  ModelCode,
  isModelType,
  listModelTypes,
  getModelCode
};
