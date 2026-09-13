'use strict';

const { normalizarNomeBusca } = require('./normalizarNomeBusca');
const { filtrarStopWords } = require('./stopWords');
const { textoContemToken } = require('./compararTextoBusca');

/**
 * Tokeniza termo de busca: remove acentos, separa palavras, remove stop words.
 * @param {string} termo
 * @returns {{ bruto: string, normalizado: string, tokens: string[], tokensNorm: string[] }}
 */
function tokenizar(termo) {
  const bruto = String(termo || '').trim();
  const partes = bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const tokens = filtrarStopWords(partes);
  const tokensNorm = tokens.map((t) => normalizarNomeBusca(t)).filter(Boolean);
  const normalizado = normalizarNomeBusca(tokens.join(' ') || bruto);

  return { bruto, normalizado, tokens, tokensNorm };
}

/**
 * Conta quantos tokens batem no nome_busca / nome.
 */
function contarTokensMatch(produto, tokensNorm) {
  if (!tokensNorm?.length) return 0;
  const nb = String(produto.nome_busca || '');
  let n = 0;
  for (const t of tokensNorm) {
    if (t && (nb.includes(t) || textoContemToken(nb, t))) n += 1;
  }
  return n;
}

module.exports = { tokenizar, contarTokensMatch };
