/**
 * MeasurementTokenizer — Reconhece tokens de medida sem dividi-los.
 *
 * Sprint 7.1 — preserva potências, voltagens, frações, dimensões e medidas.
 *
 * Exemplos preservados: 20W, 220V, 127V, 500ML, 1KG, 3/8, 5X80, 12MM, 3POL, 1/2
 *
 * @module motores/miip/utils/MeasurementTokenizer
 */

const TokenType = require('../core/TokenType');

/**
 * @param {Object} [config]
 * @returns {Array<{ regex: RegExp, tipo: string }>}
 */
function construirPadroes(config = {}) {
  const sufixos = (config.sufixos ?? ['KW', 'KG', 'MG', 'ML', 'LT', 'L', 'W', 'G', 'V', 'MM', 'POL', 'UN'])
    .map((s) => String(s).toUpperCase())
    .sort((a, b) => b.length - a.length)
    .join('|');

  const padroes = [];

  if (config.fracoes !== false) {
    padroes.push({ regex: /^\d+\/\d+/, tipo: TokenType.MEDIDA });
  }

  if (config.dimensoes !== false) {
    padroes.push({ regex: /^\d+(?:\.\d+)?X\d+(?:\.\d+)?/i, tipo: TokenType.MEDIDA });
  }

  padroes.push({ regex: new RegExp(`^\\d+\\.\\d+(?:${sufixos})`, 'i'), tipo: TokenType.MEDIDA });
  padroes.push({ regex: new RegExp(`^\\d+(?:${sufixos})`, 'i'), tipo: TokenType.MEDIDA });

  return padroes;
}

/**
 * @param {string} texto
 * @param {Object} [config]
 * @returns {Array<{ texto: string, tipo: string|null, posicao: number }>}
 */
function tokenizar(texto, config = {}) {
  const padroes = construirPadroes(config);
  const tokens = [];
  let restante = String(texto ?? '').trim();
  let posicao = 0;

  while (restante.length > 0) {
    restante = restante.replace(/^\s+/, '');
    if (!restante) break;

    let encontrado = false;

    for (const padrao of padroes) {
      const match = restante.match(padrao.regex);
      if (match) {
        tokens.push({
          texto: match[0].toUpperCase(),
          tipo: padrao.tipo,
          posicao
        });
        restante = restante.slice(match[0].length);
        posicao += 1;
        encontrado = true;
        break;
      }
    }

    if (!encontrado) {
      const palavra = restante.match(/^[^\s]+/);
      if (!palavra) break;

      tokens.push({
        texto: palavra[0].toUpperCase(),
        tipo: null,
        posicao
      });
      restante = restante.slice(palavra[0].length);
      posicao += 1;
    }
  }

  return tokens;
}

/**
 * @param {string} token
 * @param {Object} [config]
 * @returns {boolean}
 */
function ehTokenMedida(token, config = {}) {
  const padroes = construirPadroes(config);
  const chave = String(token ?? '').toUpperCase();
  return padroes.some((padrao) => padrao.regex.test(chave));
}

module.exports = {
  tokenizar,
  construirPadroes,
  ehTokenMedida
};
