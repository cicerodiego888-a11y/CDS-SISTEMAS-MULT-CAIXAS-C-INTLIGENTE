/**
 * FilasEstadosCentral — Fonte única de verdade: filas = KPIs = presets.
 * Nenhum documento deve pertencer a duas filas operacionais.
 *
 * @module motores/central-entradas/core/FilasEstadosCentral
 */

'use strict';

const { DocumentoFiscalStatus } = require('./DocumentoFiscalStatus');

const S = DocumentoFiscalStatus;

/**
 * Filas mutuamente exclusivas (statusIn disjuntos).
 */
const FILAS = Object.freeze({
  pendentes: {
    codigo: 'pendentes',
    label: 'Pendentes',
    statusIn: Object.freeze([S.NOVA, S.RESUMO_RECEBIDO, S.XML_COMPLETO])
  },
  em_revisao: {
    codigo: 'em_revisao',
    label: 'Em Revisão',
    statusIn: Object.freeze([S.EM_REVISAO])
  },
  prontas: {
    codigo: 'prontas',
    label: 'Prontas',
    statusIn: Object.freeze([S.PRONTA_IMPORTACAO])
  },
  em_importacao: {
    codigo: 'em_importacao',
    label: 'Em Importação',
    statusIn: Object.freeze([S.EM_IMPORTACAO])
  },
  importadas: {
    codigo: 'importadas',
    label: 'Importadas',
    statusIn: Object.freeze([S.IMPORTADA])
  },
  canceladas: {
    codigo: 'canceladas',
    label: 'Canceladas',
    statusIn: Object.freeze([S.CANCELADA])
  },
  denegadas: {
    codigo: 'denegadas',
    label: 'Denegadas',
    statusIn: Object.freeze([S.DENEGADA])
  },
  inutilizadas: {
    codigo: 'inutilizadas',
    label: 'Inutilizadas',
    statusIn: Object.freeze([S.INUTILIZADA])
  },
  erro: {
    codigo: 'erro',
    label: 'Erro',
    statusIn: Object.freeze([S.ERRO, S.XML_INDISPONIVEL])
  },
  finalizadas: {
    codigo: 'finalizadas',
    label: 'Finalizadas',
    statusIn: Object.freeze([S.FINALIZADA])
  }
});

/**
 * Aliases de filtro rápido / UX legada → código de fila.
 */
const ALIAS_FILA = Object.freeze({
  revisar: 'em_revisao',
  atencao: 'erro',
  xml: 'pendentes',
  aguardando_xml: 'pendentes',
  gravadas: 'importadas'
});

/**
 * @param {string} codigo
 * @returns {{ codigo: string, label: string, statusIn: string[] }|null}
 */
function obterFila(codigo) {
  const c = ALIAS_FILA[codigo] || codigo;
  return FILAS[c] || null;
}

/**
 * Soma contagens porStatus para uma fila.
 * @param {Object} porStatus
 * @param {string} codigoFila
 * @returns {number}
 */
function contarFila(porStatus, codigoFila) {
  const fila = obterFila(codigoFila);
  if (!fila) return 0;
  return fila.statusIn.reduce((acc, st) => acc + Number(porStatus?.[st] || 0), 0);
}

/**
 * Contadores alinhados às filas (mesma regra).
 * @param {Object} porStatus
 * @returns {Object}
 */
function montarContadoresFilas(porStatus = {}) {
  const out = {};
  Object.keys(FILAS).forEach((codigo) => {
    out[codigo] = contarFila(porStatus, codigo);
  });
  // Compat dashboard legado
  out.novas = Number(porStatus[S.XML_COMPLETO] || 0) + Number(porStatus[S.NOVA] || 0);
  out.emProcessamento = 0;
  out.aguardandoRevisao = out.em_revisao;
  out.prontasParaCompra = out.prontas;
  out.gravadas = out.importadas;
  out.erros = out.erro;
  out.porStatus = porStatus;
  return out;
}

/**
 * Verifica se conjuntos de filas são disjuntos.
 * @returns {boolean}
 */
function filasSaoDisjuntas() {
  const seen = new Set();
  for (const fila of Object.values(FILAS)) {
    for (const st of fila.statusIn) {
      if (seen.has(st)) return false;
      seen.add(st);
    }
  }
  return true;
}

module.exports = {
  FILAS,
  ALIAS_FILA,
  obterFila,
  contarFila,
  montarContadoresFilas,
  filasSaoDisjuntas
};
