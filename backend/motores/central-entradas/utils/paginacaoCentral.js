/**
 * paginacaoCentral — Normalização de paginação e ordenação da Central de Entradas.
 *
 * @module motores/central-entradas/utils/paginacaoCentral
 */

const CAMPOS_ORDENACAO = Object.freeze({
  created_at: 'created_at',
  data_emissao: 'data_emissao',
  valor_total: 'valor_total',
  fornecedor: 'fornecedor',
  status: 'status',
  numero: 'numero'
});

const LIMITE_MAXIMO = 100;
const LIMITE_PADRAO = 20;

/**
 * @param {Object} [filtros]
 * @returns {{ limite: number, offset: number, pagina: number, ordenarPor: string, ordenarDirecao: string }}
 */
function normalizarFiltros(filtros = {}) {
  const limite = Math.max(
    1,
    Math.min(Number(filtros.limite) || LIMITE_PADRAO, LIMITE_MAXIMO)
  );

  const paginaInformada = Number(filtros.pagina);
  const pagina = Number.isFinite(paginaInformada) && paginaInformada > 0
    ? Math.floor(paginaInformada)
    : Math.floor(Number(filtros.offset) / limite) + 1 || 1;

  const offsetInformado = filtros.offset;
  const offset = offsetInformado != null && offsetInformado !== ''
    ? Math.max(0, Number(offsetInformado) || 0)
    : (pagina - 1) * limite;

  const ordenarPor = CAMPOS_ORDENACAO[filtros.ordenarPor]
    || CAMPOS_ORDENACAO[filtros.ordenar_por]
    || CAMPOS_ORDENACAO.created_at;

  const direcaoBruta = String(
    filtros.ordenarDirecao || filtros.ordenar_direcao || 'desc'
  ).toLowerCase();

  const ordenarDirecao = direcaoBruta === 'asc' ? 'ASC' : 'DESC';

  return {
    limite,
    offset,
    pagina,
    ordenarPor,
    ordenarDirecao
  };
}

/**
 * @param {number} total
 * @param {Object} filtrosNormalizados
 * @returns {Object}
 */
function montarMetadadosPaginacao(total, filtrosNormalizados) {
  const limite = filtrosNormalizados.limite;
  const totalPaginas = total > 0 ? Math.ceil(total / limite) : 1;

  return {
    total,
    pagina: filtrosNormalizados.pagina,
    limite,
    offset: filtrosNormalizados.offset,
    totalPaginas,
    ordenarPor: filtrosNormalizados.ordenarPor,
    ordenarDirecao: filtrosNormalizados.ordenarDirecao.toLowerCase()
  };
}

module.exports = {
  CAMPOS_ORDENACAO,
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  normalizarFiltros,
  montarMetadadosPaginacao
};
