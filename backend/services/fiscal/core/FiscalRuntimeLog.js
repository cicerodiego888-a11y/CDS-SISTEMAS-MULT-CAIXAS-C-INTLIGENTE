/**
 * Logger padronizado dos runtimes da Plataforma Fiscal (RC1.1).
 *
 * Formato único:
 *   [FISCAL:<OPERACAO>] <ISO8601> | <Campo>: <valor>
 *
 * @module services/fiscal/core/FiscalRuntimeLog
 */

/**
 * @param {string} operacao OperationType ou rótulo estável
 * @param {Record<string, unknown>} fields
 */
function logFiscalRuntime(operacao, fields = {}) {
  const ts = new Date().toISOString();
  const op = String(operacao || 'UNKNOWN').toUpperCase();
  const prefix = `[FISCAL:${op}] ${ts}`;

  const entries = Object.entries(fields);
  if (entries.length === 0) {
    console.log(prefix);
    return;
  }

  for (const [key, value] of entries) {
    const rendered = formatValue(value);
    console.log(`${prefix} | ${key}: ${rendered}`);
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatValue(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

module.exports = {
  logFiscalRuntime,
  formatValue
};
