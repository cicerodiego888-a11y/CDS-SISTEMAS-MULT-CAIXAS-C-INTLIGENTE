'use strict';

/**
 * Normaliza texto para coluna produtos.nome_busca.
 * Remoção de acentos, espaços, pontuação e especiais — apenas na gravação.
 * @param {string} texto
 * @returns {string}
 */
function normalizarNomeBusca(texto) {
  if (texto == null) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Normaliza termo digitado pelo usuário (mesma regra do nome_busca).
 * @param {string} termo
 * @returns {string}
 */
function normalizarTermoBusca(termo) {
  return normalizarNomeBusca(termo);
}

module.exports = {
  normalizarNomeBusca,
  normalizarTermoBusca
};
