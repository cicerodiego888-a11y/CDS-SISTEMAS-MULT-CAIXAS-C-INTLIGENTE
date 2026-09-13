/**
 * DecimalNormalizer — Preserva e normaliza números decimais com vírgula.
 *
 * Sprint 7.1 — nunca quebra decimais em tokens separados.
 *
 * Exemplos:
 *   1,5 LT  → 1.5L
 *   2,75 KG → 2.75KG
 *
 * @module motores/miip/utils/DecimalNormalizer
 */

/**
 * @param {string} texto
 * @returns {string}
 */
function converterVirgulaDecimal(texto) {
  return String(texto ?? '').replace(/(\d+),(\d+)/g, '$1.$2');
}

/**
 * @param {string} unidade
 * @param {Object<string, string>} aliases
 * @returns {string}
 */
function resolverAliasUnidade(unidade, aliases = {}) {
  const chave = String(unidade ?? '').toUpperCase();
  return String(aliases[chave] ?? chave).toUpperCase();
}

/**
 * Cola decimal + unidade e aplica alias (ex.: LT → L).
 *
 * @param {string} texto
 * @param {string[]} unidades
 * @param {Object<string, string>} [aliases]
 * @returns {string}
 */
function colarDecimalComUnidade(texto, unidades = [], aliases = {}) {
  let resultado = String(texto ?? '');
  const lista = [...unidades].sort((a, b) => b.length - a.length);

  lista.forEach((unidade) => {
    const unidadeUpper = String(unidade).toUpperCase();
    const alias = resolverAliasUnidade(unidadeUpper, aliases);
    const padrao = new RegExp(`(\\d+\\.\\d+)\\s+${unidadeUpper}\\b`, 'gi');
    resultado = resultado.replace(padrao, `$1${alias}`);
  });

  return resultado;
}

/**
 * @param {string} texto
 * @param {Object} [config]
 * @param {string[]} [config.unidades]
 * @param {Object<string, string>} [config.aliases]
 * @returns {string}
 */
function normalizarDecimais(texto, config = {}) {
  const unidades = config.unidades ?? [];
  const aliases = config.aliases ?? {};

  let resultado = converterVirgulaDecimal(texto);
  resultado = colarDecimalComUnidade(resultado, unidades, aliases);

  return resultado;
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function ehTokenDecimalUnidade(token) {
  return /^\d+\.\d+[A-Z]{1,4}$/i.test(String(token ?? ''));
}

module.exports = {
  normalizarDecimais,
  converterVirgulaDecimal,
  colarDecimalComUnidade,
  ehTokenDecimalUnidade,
  resolverAliasUnidade
};
