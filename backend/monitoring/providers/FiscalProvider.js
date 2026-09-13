/**
 * FiscalProvider — indicadores fiscais e não fiscais de vendas/entradas.
 * RC8.3.2 — delega indicadores principais ao IndicadoresFiscaisService (competência mensal).
 */

const db = require('../../database');
const {
  getExprValorVendaNaoFiscal
} = require('../../services/reportFiscalHelpers');
const indicadoresFiscaisService = require('../../services/IndicadoresFiscaisService');
const { criarMonitoringResult } = require('../MonitoringResult');
const {
  resolverCompetencia,
  periodoHoje,
  periodoAnoCompetencia,
  num,
  dbGetFactory
} = require('../monitoringDateHelpers');

const dbGet = dbGetFactory(db);

async function agregarVendasNaoFiscais(inicio, fim) {
  const exprNaoFiscal = getExprValorVendaNaoFiscal();
  const row = await dbGet(
    `SELECT
       COALESCE(SUM(${exprNaoFiscal}), 0) AS valor,
       COUNT(CASE WHEN COALESCE(${exprNaoFiscal}, 0) > 0 THEN 1 END) AS quantidade
     FROM vendas v
     WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
       AND (v.status IS NULL OR v.status != 'cancelada')`,
    [inicio, fim]
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function ultimaEntradaFiscal() {
  const row = await dbGet(
    `SELECT numero, chave, fornecedor, valor_total, data_emissao, data_entrada, created_at
     FROM central_entradas_documentos
     ORDER BY datetime(COALESCE(data_entrada, data_emissao, created_at)) DESC, id DESC
     LIMIT 1`
  );
  if (!row || (!row.chave && !row.numero)) {
    return { ultimaNf: null, fornecedor: null };
  }
  return {
    ultimaNf: {
      numero: row.numero || null,
      chave: row.chave || null,
      valor: num(row.valor_total),
      data: row.data_entrada || row.data_emissao || row.created_at || null
    },
    fornecedor: row.fornecedor || null
  };
}

/** Entradas não fiscais = compras manuais (sem chave de acesso NF-e). */
async function agregarEntradasNaoFiscais(inicio, fim) {
  const row = await dbGet(
    `SELECT
       COALESCE(SUM(COALESCE(NULLIF(valor_total_nota, 0), total, 0)), 0) AS valor,
       COUNT(*) AS quantidade
     FROM compras
     WHERE date(COALESCE(data_entrada, data_compra, created_at)) BETWEEN date(?) AND date(?)
       AND (chave_acesso IS NULL OR TRIM(chave_acesso) = '')`,
    [inicio, fim]
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function ultimaEntradaNaoFiscal() {
  const row = await dbGet(
    `SELECT numero_nf, fornecedor, COALESCE(NULLIF(valor_total_nota, 0), total, 0) AS valor_total,
            data_entrada, data_compra, created_at
     FROM compras
     WHERE chave_acesso IS NULL OR TRIM(chave_acesso) = ''
     ORDER BY datetime(COALESCE(data_entrada, data_compra, created_at)) DESC, id DESC
     LIMIT 1`
  );
  if (!row || (!row.numero_nf && !row.fornecedor && !num(row.valor_total))) {
    return { ultimaNf: null, fornecedor: null };
  }
  return {
    ultimaNf: {
      numero: row.numero_nf || null,
      chave: null,
      valor: num(row.valor_total),
      data: row.data_entrada || row.data_compra || row.created_at || null
    },
    fornecedor: row.fornecedor || null
  };
}

function montarBlocoPeriodo(hoje, mes, ano) {
  return {
    valor: mes.valor,
    quantidade: mes.quantidade,
    hoje,
    mes,
    ano
  };
}

const FiscalProvider = {
  id: 'fiscal',

  async collect(context = {}) {
    const inicio = Date.now();
    const warnings = [];
    const errors = [];

    try {
      const competenciaInput = context.competencia
        ? context.competencia
        : resolverCompetencia(context);
      const periodoComp = competenciaInput.inicio && competenciaInput.fim
        ? competenciaInput
        : resolverCompetencia({
          ano: context.ano,
          mes: context.mes,
          competencia: context.competencia?.competencia
        });

      const hoje = periodoHoje();
      const ano = periodoAnoCompetencia(periodoComp.ano);

      const [
        resumoFiscal,
        vendasNaoFiscalHoje,
        vendasNaoFiscalMes,
        vendasNaoFiscalAno,
        ultimaFiscal,
        entradasNaoFiscalHoje,
        entradasNaoFiscalMes,
        entradasNaoFiscalAno,
        ultimaNaoFiscal
      ] = await Promise.all([
        indicadoresFiscaisService.obterResumo({
          ano: periodoComp.ano,
          mes: periodoComp.mes,
          competencia: periodoComp.competencia
        }),
        agregarVendasNaoFiscais(hoje.inicio, hoje.fim),
        agregarVendasNaoFiscais(periodoComp.inicio, periodoComp.fim),
        agregarVendasNaoFiscais(ano.inicio, ano.fim),
        ultimaEntradaFiscal(),
        agregarEntradasNaoFiscais(hoje.inicio, hoje.fim),
        agregarEntradasNaoFiscais(periodoComp.inicio, periodoComp.fim),
        agregarEntradasNaoFiscais(ano.inicio, ano.fim),
        ultimaEntradaNaoFiscal()
      ]);

      const data = {
        indicadoresFiscais: {
          competencia: resumoFiscal.competencia,
          competenciaLabel: resumoFiscal.competenciaLabel,
          valorTotalVendido: resumoFiscal.valorTotalVendido,
          valorTotalComprado: resumoFiscal.valorTotalComprado,
          quantidadeNfeEmitidas: resumoFiscal.quantidadeNfeEmitidas,
          ambiente: resumoFiscal.ambiente,
          ambienteLabel: resumoFiscal.ambienteLabel
        },
        vendas: montarBlocoPeriodo(resumoFiscal.vendas.hoje, resumoFiscal.vendas.mes, resumoFiscal.vendas.ano),
        entradas: {
          ...montarBlocoPeriodo(resumoFiscal.entradas.hoje, resumoFiscal.entradas.mes, resumoFiscal.entradas.ano),
          ultimaNf: ultimaFiscal.ultimaNf,
          fornecedor: ultimaFiscal.fornecedor
        },
        naoFiscal: {
          vendas: montarBlocoPeriodo(vendasNaoFiscalHoje, vendasNaoFiscalMes, vendasNaoFiscalAno),
          entradas: {
            ...montarBlocoPeriodo(entradasNaoFiscalHoje, entradasNaoFiscalMes, entradasNaoFiscalAno),
            ultimaNf: ultimaNaoFiscal.ultimaNf,
            fornecedor: ultimaNaoFiscal.fornecedor
          }
        }
      };

      return criarMonitoringResult({
        success: true,
        source: 'FiscalProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data,
        warnings,
        errors
      });
    } catch (err) {
      errors.push(err.message || String(err));
      const vazio = { valor: 0, quantidade: 0 };
      return criarMonitoringResult({
        success: false,
        source: 'FiscalProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: {
          indicadoresFiscais: {
            competencia: null,
            competenciaLabel: null,
            valorTotalVendido: 0,
            valorTotalComprado: 0,
            quantidadeNfeEmitidas: 0,
            ambiente: 2,
            ambienteLabel: 'Homologação'
          },
          vendas: montarBlocoPeriodo(vazio, vazio, vazio),
          entradas: {
            ...montarBlocoPeriodo(vazio, vazio, vazio),
            ultimaNf: null,
            fornecedor: null
          },
          naoFiscal: {
            vendas: montarBlocoPeriodo(vazio, vazio, vazio),
            entradas: {
              ...montarBlocoPeriodo(vazio, vazio, vazio),
              ultimaNf: null,
              fornecedor: null
            }
          }
        },
        warnings,
        errors
      });
    }
  }
};

module.exports = FiscalProvider;
