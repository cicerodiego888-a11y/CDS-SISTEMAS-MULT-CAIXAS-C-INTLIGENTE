/**
 * Logger padronizado da Central Inteligente de Entradas (RC3).
 *
 * Formato: [Central Entradas][<AREA>] <ISO8601> | Campo: valor
 *
 * @module motores/central-entradas/utils/centralLog
 */

/**
 * @param {string} area
 * @param {Record<string, unknown>} [fields]
 */
function logCentral(area, fields = {}) {
  const ts = new Date().toISOString();
  const tag = String(area || 'GERAL').toUpperCase();
  const prefix = `[Central Entradas][${tag}] ${ts}`;
  const entries = Object.entries(fields || {});

  if (entries.length === 0) {
    console.log(prefix);
    return;
  }

  for (const [key, value] of entries) {
    let rendered = value;
    if (value === null || value === undefined) rendered = String(value);
    else if (typeof value === 'object') rendered = JSON.stringify(value);
    console.log(`${prefix} | ${key}: ${rendered}`);
  }
}

/**
 * @param {string} area
 * @param {string|Error} error
 * @param {Record<string, unknown>} [fields]
 */
function logCentralErro(area, error, fields = {}) {
  const message = error && error.message ? error.message : String(error);
  logCentral(area, { ...fields, erro: message });
}

module.exports = {
  logCentral,
  logCentralErro
};
