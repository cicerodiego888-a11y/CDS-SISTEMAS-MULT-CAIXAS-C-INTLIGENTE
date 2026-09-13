/**
 * RC3.6.C — Normalização da pesquisa textual da Central de Entradas.
 * Usado exclusivamente na montagem do WHERE (Repository).
 *
 * @module motores/central-entradas/utils/normalizarBuscaCentral
 */

'use strict';

const MAPA_ACENTOS = Object.freeze([
  [/[áàâãäÁÀÂÃÄ]/g, 'a'],
  [/[éèêëÉÈÊË]/g, 'e'],
  [/[íìîïÍÌÎÏ]/g, 'i'],
  [/[óòôõöÓÒÔÕÖ]/g, 'o'],
  [/[úùûüÚÙÛÜ]/g, 'u'],
  [/[çÇ]/g, 'c'],
  [/[ñÑ]/g, 'n']
]);

/**
 * Remove acentos / diacríticos comuns (PT-BR).
 * @param {string} texto
 * @returns {string}
 */
function removerAcentos(texto) {
  let out = String(texto || '');
  MAPA_ACENTOS.forEach(([re, sub]) => {
    out = out.replace(re, sub);
  });
  return out;
}

/**
 * Normaliza texto livre (fornecedor / razão social).
 * @param {string} texto
 * @returns {string}
 */
function normalizarTextoBusca(texto) {
  return removerAcentos(
    String(texto || '')
      .replace(/&amp;/gi, '&')
      .replace(/&#38;/g, '&')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

/**
 * Extrai apenas dígitos (CNPJ, chave, número NF).
 * @param {string} texto
 * @returns {string}
 */
function apenasDigitos(texto) {
  return String(texto || '').replace(/\D/g, '');
}

/**
 * Número da NF sem zeros à esquerda (mantém "0" se tudo zero).
 * @param {string} digitos
 * @returns {string}
 */
function numeroSemZerosEsquerda(digitos) {
  const d = apenasDigitos(digitos);
  if (!d) return '';
  const limpo = d.replace(/^0+/, '');
  return limpo || '0';
}

/**
 * Expressão SQL que normaliza fornecedor para comparação (SQLite).
 * @param {string} [coluna='fornecedor']
 * @returns {string}
 */
function sqlExprFornecedorNormalizado(coluna = 'fornecedor') {
  let expr = `IFNULL(${coluna}, '')`;
  const pares = [
    ['&amp;', '&'], ['&AMP;', '&'],
    ['Á', 'a'], ['À', 'a'], ['Â', 'a'], ['Ã', 'a'], ['á', 'a'], ['à', 'a'], ['â', 'a'], ['ã', 'a'],
    ['É', 'e'], ['Ê', 'e'], ['é', 'e'], ['ê', 'e'],
    ['Í', 'i'], ['í', 'i'],
    ['Ó', 'o'], ['Ô', 'o'], ['Õ', 'o'], ['ó', 'o'], ['ô', 'o'], ['õ', 'o'],
    ['Ú', 'u'], ['ú', 'u'],
    ['Ç', 'c'], ['ç', 'c']
  ];
  pares.forEach(([de, para]) => {
    expr = `REPLACE(${expr}, '${de}', '${para}')`;
  });
  return `LOWER(${expr})`;
}

/**
 * Expressão SQL: CNPJ só dígitos.
 * @param {string} [coluna='cnpj_fornecedor']
 * @returns {string}
 */
function sqlExprCnpjDigitos(coluna = 'cnpj_fornecedor') {
  return `REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(${coluna}, ''), '.', ''), '/', ''), '-', ''), ' ', '')`;
}

/**
 * Monta cláusula OR de busca inteligente + params.
 * @param {string} busca
 * @returns {{ sql: string, params: string[], meta: Object }|null}
 */
function montarClausulaBuscaInteligente(busca) {
  const bruto = String(busca || '').trim();
  if (!bruto) return null;

  const texto = normalizarTextoBusca(bruto);
  const digitos = apenasDigitos(bruto);
  const nfe = numeroSemZerosEsquerda(digitos);

  const partes = [];
  const params = [];

  if (texto) {
    partes.push(`${sqlExprFornecedorNormalizado('fornecedor')} LIKE ?`);
    params.push(`%${texto}%`);
  }

  if (digitos) {
    partes.push('IFNULL(chave, \'\') LIKE ?');
    params.push(`%${digitos}%`);

    partes.push(`${sqlExprCnpjDigitos('cnpj_fornecedor')} LIKE ?`);
    params.push(`%${digitos}%`);

    partes.push('IFNULL(numero, \'\') LIKE ?');
    params.push(`%${digitos}%`);

    // 64706 ≡ 064706 ≡ 00064706
    partes.push('LTRIM(IFNULL(numero, \'\'), \'0\') = LTRIM(?, \'0\')');
    params.push(digitos);

    if (nfe && nfe !== digitos) {
      partes.push('IFNULL(chave, \'\') LIKE ?');
      params.push(`%${nfe}%`);
      partes.push('IFNULL(numero, \'\') LIKE ?');
      params.push(`%${nfe}%`);
      partes.push('LTRIM(IFNULL(numero, \'\'), \'0\') = ?');
      params.push(nfe);
    }
  }

  if (!partes.length) return null;

  return {
    sql: `(${partes.join(' OR ')})`,
    params,
    meta: {
      bruto,
      texto,
      digitos: digitos || null,
      numeroNormalizado: nfe || null
    }
  };
}

module.exports = {
  removerAcentos,
  normalizarTextoBusca,
  apenasDigitos,
  numeroSemZerosEsquerda,
  sqlExprFornecedorNormalizado,
  sqlExprCnpjDigitos,
  montarClausulaBuscaInteligente
};
