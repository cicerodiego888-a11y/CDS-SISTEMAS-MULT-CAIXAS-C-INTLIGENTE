/**
 * SynonymDictionary — Carregador dos dicionários de sinônimos do MIIP.
 *
 * Sprint 9 — não consulta banco, XML ou serviços externos.
 *
 * @module motores/miip/utils/SynonymDictionary
 */

const path = require('path');
const fs = require('fs');
const SynonymMatch = require('../core/SynonymMatch');

const DEFAULT_SYNONYM_DIR = path.join(__dirname, '../config/synonyms');
const CATEGORIAS_PADRAO = Object.freeze([
  'general',
  'construction',
  'electrical',
  'hydraulic',
  'grocery',
  'stationery',
  'hardware'
]);

/** @type {Object|null} */
let _cache = null;

/**
 * @param {string} arquivo
 * @returns {Object}
 */
function lerJsonSeguro(arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {string} valor
 * @returns {string}
 */
function normalizarChave(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} [diretorio]
 * @returns {{ categorias: string[], indice: Map<string, Array<{ sinonimo: string, categoria: string, origem: string }>> }}
 */
function carregar(diretorio = DEFAULT_SYNONYM_DIR) {
  if (_cache && diretorio === DEFAULT_SYNONYM_DIR) {
    return _cache;
  }

  const indice = new Map();
  const categorias = [];

  CATEGORIAS_PADRAO.forEach((categoria) => {
    const arquivo = path.join(diretorio, `${categoria}.json`);
    const conteudo = lerJsonSeguro(arquivo);
    const sinonimos = conteudo.sinonimos ?? {};

    if (Object.keys(sinonimos).length === 0) return;
    categorias.push(categoria);

    Object.entries(sinonimos).forEach(([original, equivalentes]) => {
      const chave = normalizarChave(original);
      const lista = Array.isArray(equivalentes) ? equivalentes : [equivalentes];
      const registros = indice.get(chave) ?? [];

      lista.filter(Boolean).forEach((sinonimo) => {
        registros.push({
          sinonimo: normalizarChave(sinonimo),
          categoria,
          origem: `${categoria}.json`
        });
      });

      indice.set(chave, registros);
    });
  });

  const dicionario = { categorias, indice };

  if (diretorio === DEFAULT_SYNONYM_DIR) {
    _cache = dicionario;
  }

  return dicionario;
}

/**
 * @returns {void}
 */
function reiniciarCache() {
  _cache = null;
}

/**
 * @param {string} termo
 * @param {Object} [opcoes]
 * @param {string} [opcoes.diretorio]
 * @returns {SynonymMatch[]}
 */
function buscar(termo, opcoes = {}) {
  const chave = normalizarChave(termo);
  if (!chave) return [];

  const dicionario = carregar(opcoes.diretorio ?? DEFAULT_SYNONYM_DIR);
  const registros = dicionario.indice.get(chave) ?? [];

  return registros.map((registro) => SynonymMatch.create({
    original: chave,
    sinonimo: registro.sinonimo,
    categoria: registro.categoria,
    confianca: 100,
    origem: registro.origem
  }));
}

module.exports = {
  carregar,
  buscar,
  reiniciarCache,
  normalizarChave,
  CATEGORIAS_PADRAO,
  DEFAULT_SYNONYM_DIR
};
