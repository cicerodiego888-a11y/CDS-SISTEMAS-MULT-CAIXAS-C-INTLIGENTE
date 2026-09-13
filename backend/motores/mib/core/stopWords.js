'use strict';

const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'por', 'em', 'no', 'na',
  'tipo', 'unidade', 'pacote', 'caixa', 'lata', 'ml', 'kg', 'g', 'l',
  'un', 'und', 'pct', 'cx', 'lt', 'gr'
]);

/**
 * Remove stop words de uma lista de tokens.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function filtrarStopWords(tokens) {
  return (tokens || []).filter((t) => {
    const x = String(t || '').toLowerCase();
    return x && !STOP_WORDS.has(x) && !(x.length <= 1 && !/\d/.test(x));
  });
}

module.exports = { STOP_WORDS, filtrarStopWords };
