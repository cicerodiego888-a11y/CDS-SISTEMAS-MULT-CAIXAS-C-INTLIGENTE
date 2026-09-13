'use strict';

/**
 * Distância de Levenshtein (otimizada para strings curtas de busca).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  // Early exit se diferença de tamanho já excede uso típico
  const maxLen = Math.max(s.length, t.length);
  if (Math.abs(s.length - t.length) > maxLen) return maxLen;

  const prev = new Array(t.length + 1);
  const curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + custo
      );
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = curr[j];
  }
  return prev[t.length];
}

/**
 * Similaridade 0..1
 */
function similaridade(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const maxLen = Math.max(s.length, t.length);
  if (!maxLen) return 1;
  return 1 - (levenshtein(s, t) / maxLen);
}

module.exports = { levenshtein, similaridade };
