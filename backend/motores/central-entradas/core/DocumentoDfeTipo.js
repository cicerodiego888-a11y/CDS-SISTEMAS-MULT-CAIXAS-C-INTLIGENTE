/**
 * DocumentoDfeTipo — Enum oficial dos tipos de documento da Distribuição DF-e.
 *
 * RC6.1: preparação arquitetural. Não altera pipeline, status ou parser.
 *
 * @module motores/central-entradas/core/DocumentoDfeTipo
 */

const DocumentoDfeTipo = Object.freeze({
  RES_NFE: 'RES_NFE',
  PROC_NFE: 'PROC_NFE',
  NFE: 'NFE',
  PROC_EVENTO_NFE: 'PROC_EVENTO_NFE',
  RES_EVENTO: 'RES_EVENTO',
  DESCONHECIDO: 'DESCONHECIDO'
});

const TODOS = Object.freeze(Object.values(DocumentoDfeTipo));

/** Mapa raiz XML (localName) → tipo oficial. */
const RAIZ_PARA_TIPO = Object.freeze({
  resNFe: DocumentoDfeTipo.RES_NFE,
  nfeProc: DocumentoDfeTipo.PROC_NFE,
  NFe: DocumentoDfeTipo.NFE,
  procEventoNFe: DocumentoDfeTipo.PROC_EVENTO_NFE,
  resEvento: DocumentoDfeTipo.RES_EVENTO
});

/**
 * @param {string} tipo
 * @returns {boolean}
 */
function isValido(tipo) {
  return TODOS.includes(tipo);
}

module.exports = {
  DocumentoDfeTipo,
  TODOS,
  RAIZ_PARA_TIPO,
  isValido
};
