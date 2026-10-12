'use strict';

/**
 * Semelhança de descrição — mesma regra no MUBC e na revalidação de resultados gravados.
 * Só conta palavra descritiva em comum; medida ou unidade sozinha (400G, 2L, KG, CAIXA) não.
 *
 * @module motores/miip/utils/evidenciaDescricao
 */

const CanonicalNormalizer = require('./CanonicalNormalizer');

const UNIDADES_MEDIDA = new Set([
  'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'PCT', 'PACOTE', 'CXA', 'CAIXA', 'FARDO', 'LITRO', 'LITROS',
  'GRAMA', 'GRAMAS', 'GRS', 'QUILO', 'QUILOS', 'KILO', 'KILOS', 'METRO', 'METROS', 'PECA', 'PECAS'
]);

/** Token que descreve o produto: ≥ 3 letras e não é unidade (400G, 2L, KG, CAIXA não contam). */
function tokenDescritivo(token) {
  const t = String(token || '').toUpperCase();
  return (t.match(/[A-Z]/g) || []).length >= 3 && !UNIDADES_MEDIDA.has(t);
}

/**
 * @param {string} nome
 * @returns {string[]}
 */
function extrairTokensDescricao(nome) {
  if (!nome) return [];
  let canonico = String(nome).toUpperCase();
  try {
    const produto = CanonicalNormalizer.normalizar(nome);
    canonico = produto?.canonico || produto?.original || canonico;
  } catch {
    /* fallback */
  }

  return String(canonico)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !/^(DE|DA|DO|DAS|DOS|E|COM|SEM|PARA|UM|UMA)$/i.test(t));
}

/**
 * @param {string[]} tokensXml
 * @param {string} nomeCadastro
 * @returns {{ tipo: 'descricao'|'descricao_medida', tokens: number }|null}
 */
function avaliarDescricao(tokensXml, nomeCadastro) {
  const nomeCad = String(nomeCadastro || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let tokensHit = 0;
  let tokensDescritivos = 0;
  (tokensXml || []).forEach((t) => {
    if (!nomeCad.includes(t)) return;
    tokensHit += 1;
    if (tokenDescritivo(t)) tokensDescritivos += 1;
  });
  if (tokensHit === 0) return null;
  return { tipo: tokensDescritivos > 0 ? 'descricao' : 'descricao_medida', tokens: tokensHit };
}

module.exports = {
  UNIDADES_MEDIDA,
  tokenDescritivo,
  extrairTokensDescricao,
  avaliarDescricao
};
