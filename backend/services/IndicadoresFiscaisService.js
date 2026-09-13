/**
 * RC8.3.2 / RC8.3.3 — Indicadores Fiscais (serviço único).
 * Competência fiscal oficial: data_emissao da NF-e (nunca created_at / updated_at / data_importacao).
 * Somente leitura — não altera regras fiscais, XML ou motores.
 */

'use strict';

const db = require('../database');
const {
  FILTRO_VENDA_VALIDA,
  getExprValorVendaFiscal
} = require('./reportFiscalHelpers');
const {
  resolverCompetencia,
  periodoAnoCompetencia,
  periodoHoje,
  num,
  dbGetFactory
} = require('../monitoring/monitoringDateHelpers');
const { DocumentoFiscalStatus } = require('../motores/central-entradas/core/DocumentoFiscalStatus');

const dbGet = dbGetFactory(db);

/** Status de entrada equivalentes a cancelada / inválida para contagem de NF-e. */
const STATUS_EXCLUIDOS_CONTAGEM = Object.freeze([
  DocumentoFiscalStatus.DESCARTADA,
  DocumentoFiscalStatus.DUPLICADA
]);

const STATUS_NFE_EXCLUIDOS = Object.freeze([
  'cancelada',
  'denegada',
  'inutilizada'
]);

async function obterAmbienteConfigurado() {
  try {
    const row = await dbGet(
      `SELECT valor FROM configuracoes WHERE chave = 'fiscal_ambiente' LIMIT 1`
    );
    const ambiente = Number(row?.valor);
    if ([1, 2].includes(ambiente)) return ambiente;
  } catch {
    /* fallback homologação */
  }
  return 2;
}

function labelAmbiente(ambiente) {
  return Number(ambiente) === 1 ? 'Produção' : 'Homologação';
}

/**
 * Intersecta dois períodos YYYY-MM-DD. Se vazio, retorna flag vazio.
 * @param {{ inicio: string, fim: string }} a
 * @param {{ inicio: string, fim: string }|null} b
 */
function intersectarPeriodos(a, b) {
  if (!a) return { inicio: null, fim: null, vazio: true };
  if (!b || (!b.inicio && !b.fim)) {
    return { inicio: a.inicio, fim: a.fim, vazio: false };
  }
  const inicio = [a.inicio, b.inicio].filter(Boolean).sort().pop();
  const fim = [a.fim, b.fim].filter(Boolean).sort()[0];
  if (!inicio || !fim || inicio > fim) {
    return { inicio: inicio || a.inicio, fim: fim || a.fim, vazio: true };
  }
  return { inicio, fim, vazio: false };
}

/**
 * Resolve competência + períodos mensal/anual respeitando filtro de data_emissao.
 * @param {Object} [input]
 */
function resolverPeriodosIndicadores(input = {}) {
  const inicioFiltro = input.dataEmissaoInicio || input.data_emissao_inicio || null;
  const fimFiltro = input.dataEmissaoFim || input.data_emissao_fim || null;
  const filtro = (inicioFiltro || fimFiltro)
    ? {
      inicio: inicioFiltro || '1900-01-01',
      fim: fimFiltro || '9999-12-31'
    }
    : null;

  let competenciaInput = input;
  if (filtro && input.ano == null && input.mes == null && !input.competencia) {
    const ref = String(fimFiltro || inicioFiltro).slice(0, 10);
    const match = ref.match(/^(\d{4})-(\d{2})/);
    if (match) {
      competenciaInput = { ano: Number(match[1]), mes: Number(match[2]) };
    }
  }

  const competencia = resolverCompetencia(competenciaInput);
  const periodoAno = periodoAnoCompetencia(competencia.ano);

  return {
    competencia,
    filtro,
    periodoMensal: intersectarPeriodos(competencia, filtro),
    periodoAnual: intersectarPeriodos(periodoAno, filtro)
  };
}

/**
 * Valor total vendido (fiscal) na competência — referência data_venda.
 * @param {{ inicio: string, fim: string }} periodo
 */
async function obterValorTotalVendido(periodo) {
  if (!periodo?.inicio || !periodo?.fim || periodo.vazio) {
    return { valor: 0, quantidade: 0 };
  }
  const exprFiscal = getExprValorVendaFiscal();
  const row = await dbGet(
    `SELECT
       COALESCE(SUM(${exprFiscal}), 0) AS valor,
       COUNT(CASE WHEN COALESCE(${exprFiscal}, 0) > 0 THEN 1 END) AS quantidade
     FROM vendas v
     WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
       AND ${FILTRO_VENDA_VALIDA}`,
    [periodo.inicio, periodo.fim]
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

/**
 * Valor / quantidade de entradas DF-e por data_emissao.
 * Valor: soma todas as NF-e do período (salvo excluirInvalidas=true).
 * Quantidade: sempre exclui DESCARTADA/DUPLICADA.
 * @param {{ inicio: string, fim: string, vazio?: boolean }} periodo
 * @param {{ excluirInvalidas?: boolean }} [opcoes]
 */
async function obterAgregadoEntradasPorEmissao(periodo, opcoes = {}) {
  if (!periodo?.inicio || !periodo?.fim || periodo.vazio) {
    return { valor: 0, quantidade: 0 };
  }

  const placeholders = STATUS_EXCLUIDOS_CONTAGEM.map(() => '?').join(', ');
  const excluirNoValor = opcoes.excluirInvalidas === true;

  const valorExpr = excluirNoValor
    ? `COALESCE(SUM(CASE WHEN UPPER(COALESCE(status, '')) NOT IN (${placeholders}) THEN valor_total ELSE 0 END), 0)`
    : 'COALESCE(SUM(valor_total), 0)';

  const params = [];
  if (excluirNoValor) params.push(...STATUS_EXCLUIDOS_CONTAGEM);
  params.push(...STATUS_EXCLUIDOS_CONTAGEM);
  params.push(periodo.inicio, periodo.fim);

  const row = await dbGet(
    `SELECT
       ${valorExpr} AS valor,
       COALESCE(SUM(CASE
         WHEN UPPER(COALESCE(status, '')) NOT IN (${placeholders}) THEN 1 ELSE 0 END), 0) AS quantidade
     FROM central_entradas_documentos
     WHERE data_emissao IS NOT NULL
       AND TRIM(data_emissao) != ''
       AND date(data_emissao) BETWEEN date(?) AND date(?)`,
    params
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

/**
 * Valor total comprado (entradas DF-e) na competência — referência data_emissao.
 * @param {{ inicio: string, fim: string }} periodo
 */
async function obterValorTotalComprado(periodo) {
  return obterAgregadoEntradasPorEmissao(periodo, { excluirInvalidas: false });
}

/**
 * Quantidade de NF-e autorizadas na competência (ambiente configurado).
 * Exclui canceladas, denegadas e inutilizadas.
 * Referência temporal: data_venda da venda vinculada (nfe_notas não possui data_emissao).
 * @param {{ inicio: string, fim: string, vazio?: boolean }} periodo
 * @param {number} ambiente
 */
async function obterQuantidadeNfeEmitidas(periodo, ambiente) {
  if (!periodo?.inicio || !periodo?.fim || periodo.vazio) return 0;

  const excluidos = STATUS_NFE_EXCLUIDOS.map(() => '?').join(', ');
  const row = await dbGet(
    `SELECT COUNT(*) AS quantidade
     FROM nfe_notas n
     INNER JOIN vendas v ON v.id = n.venda_id
     WHERE LOWER(COALESCE(n.status, '')) = 'autorizada'
       AND LOWER(COALESCE(n.status, '')) NOT IN (${excluidos})
       AND COALESCE(n.ambiente, 2) = ?
       AND date(v.data_venda) BETWEEN date(?) AND date(?)
       AND ${FILTRO_VENDA_VALIDA}`,
    [...STATUS_NFE_EXCLUIDOS, ambiente, periodo.inicio, periodo.fim]
  );
  return num(row.quantidade);
}

/**
 * RC8.3.3 — Indicadores da Central de Inteligência (data_emissao).
 * Retorna valorMensal, valorAnual, quantidadeMensal, quantidadeAnual.
 * @param {Object} [input] — { ano, mes, competencia, dataEmissaoInicio, dataEmissaoFim }
 */
async function obterIndicadoresCentral(input = {}) {
  const resolvido = resolverPeriodosIndicadores(input);
  const ambiente = await obterAmbienteConfigurado();

  const [mes, ano] = await Promise.all([
    obterAgregadoEntradasPorEmissao(resolvido.periodoMensal, { excluirInvalidas: false }),
    obterAgregadoEntradasPorEmissao(resolvido.periodoAnual, { excluirInvalidas: false })
  ]);

  return {
    valorMensal: mes.valor,
    valorAnual: ano.valor,
    quantidadeMensal: mes.quantidade,
    quantidadeAnual: ano.quantidade,
    competencia: resolvido.competencia.competencia,
    competenciaLabel: resolvido.competencia.label,
    ano: resolvido.competencia.ano,
    mes: resolvido.competencia.mes,
    periodoMensal: {
      inicio: resolvido.periodoMensal.inicio,
      fim: resolvido.periodoMensal.fim
    },
    periodoAnual: {
      inicio: resolvido.periodoAnual.inicio,
      fim: resolvido.periodoAnual.fim
    },
    filtro: resolvido.filtro,
    ambiente,
    ambienteLabel: labelAmbiente(ambiente),
    baseCalculo: 'data_emissao'
  };
}

/**
 * Resumo consolidado dos indicadores fiscais por competência.
 * @param {Object} [input] — { ano, mes, competencia } ou contexto Monitoring
 */
async function obterResumo(input = {}) {
  const competencia = resolverCompetencia(input);
  const periodoHojeStr = periodoHoje();
  const periodoAno = periodoAnoCompetencia(competencia.ano);

  const ambiente = await obterAmbienteConfigurado();

  const [
    vendasCompetencia,
    vendasHoje,
    vendasAno,
    comprasCompetencia,
    comprasHoje,
    comprasAno,
    quantidadeNfeEmitidas,
    indicadoresCentral
  ] = await Promise.all([
    obterValorTotalVendido(competencia),
    obterValorTotalVendido(periodoHojeStr),
    obterValorTotalVendido(periodoAno),
    obterValorTotalComprado(competencia),
    obterValorTotalComprado(periodoHojeStr),
    obterValorTotalComprado(periodoAno),
    obterQuantidadeNfeEmitidas(competencia, ambiente),
    obterIndicadoresCentral(input)
  ]);

  return {
    competencia: competencia.competencia,
    competenciaLabel: competencia.label,
    ano: competencia.ano,
    mes: competencia.mes,
    periodo: {
      inicio: competencia.inicio,
      fim: competencia.fim
    },
    ambiente,
    ambienteLabel: labelAmbiente(ambiente),
    valorTotalVendido: vendasCompetencia.valor,
    valorTotalComprado: comprasCompetencia.valor,
    quantidadeNfeEmitidas,
    valorMensal: indicadoresCentral.valorMensal,
    valorAnual: indicadoresCentral.valorAnual,
    quantidadeMensal: indicadoresCentral.quantidadeMensal,
    quantidadeAnual: indicadoresCentral.quantidadeAnual,
    vendas: {
      valor: vendasCompetencia.valor,
      quantidade: vendasCompetencia.quantidade,
      hoje: vendasHoje,
      mes: vendasCompetencia,
      ano: vendasAno
    },
    entradas: {
      valor: comprasCompetencia.valor,
      quantidade: comprasCompetencia.quantidade,
      hoje: comprasHoje,
      mes: comprasCompetencia,
      ano: comprasAno
    }
  };
}

module.exports = {
  obterAmbienteConfigurado,
  obterValorTotalVendido,
  obterValorTotalComprado,
  obterQuantidadeNfeEmitidas,
  obterAgregadoEntradasPorEmissao,
  obterIndicadoresCentral,
  obterResumo,
  resolverPeriodosIndicadores,
  intersectarPeriodos,
  labelAmbiente,
  STATUS_EXCLUIDOS_CONTAGEM,
  STATUS_NFE_EXCLUIDOS
};
