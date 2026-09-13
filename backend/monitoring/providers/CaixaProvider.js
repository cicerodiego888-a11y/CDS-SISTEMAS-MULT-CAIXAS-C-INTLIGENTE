/**
 * CaixaProvider — indicadores de sessão fiscal / não fiscal (somente leitura).
 */

const db = require('../../database');
const { FILTRO_VENDA_VALIDA, getExprValorVendaFiscal, getExprValorVendaNaoFiscal } = require('../../services/reportFiscalHelpers');
const { criarMonitoringResult } = require('../MonitoringResult');
const { num, dbGetFactory } = require('../monitoringDateHelpers');

const dbGet = dbGetFactory(db);

async function obterSessaoAberta() {
  const sessao = await dbGet(
    `SELECT * FROM caixa_sessoes WHERE status = 'aberto' ORDER BY id DESC LIMIT 1`
  );
  if (sessao && sessao.id) return { tipo: 'sessao', row: sessao };

  const caixa = await dbGet(
    `SELECT * FROM caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1`
  );
  if (caixa && caixa.id) return { tipo: 'caixa', row: caixa };
  return null;
}

async function sumVendasSessao(exprValor, sessaoId, caixaId) {
  if (sessaoId) {
    return dbGet(
      `SELECT COALESCE(SUM(${exprValor}), 0) AS total
       FROM vendas v
       WHERE ${FILTRO_VENDA_VALIDA} AND v.caixa_sessao_id = ?`,
      [sessaoId]
    );
  }
  if (caixaId) {
    return dbGet(
      `SELECT COALESCE(SUM(${exprValor}), 0) AS total
       FROM vendas v
       WHERE ${FILTRO_VENDA_VALIDA} AND v.caixa_id = ?`,
      [caixaId]
    );
  }
  return { total: 0 };
}

async function sumMovimentacoes(tipo, sessaoId, caixaId) {
  if (sessaoId) {
    return dbGet(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM caixa_movimentacoes
       WHERE sessao_id = ? AND tipo = ?`,
      [sessaoId, tipo]
    );
  }
  if (caixaId) {
    return dbGet(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM caixa_movimentacoes
       WHERE caixa_id = ? AND tipo = ?`,
      [caixaId, tipo]
    );
  }
  return { total: 0 };
}

function montarBlocoCaixa({ abertura, entradas, sangrias, suprimentos, fechamento, status, sessaoId, abertoEm, fechadoEm }) {
  const saidas = num(sangrias);
  const saldo = num(abertura) + num(entradas) + num(suprimentos) - saidas;
  return {
    saldo,
    entradas: num(entradas),
    saidas,
    suprimentos: num(suprimentos),
    sangrias: num(sangrias),
    abertura: num(abertura),
    fechamento: fechamento != null ? num(fechamento) : null,
    status: status || null,
    sessaoId: sessaoId || null,
    abertoEm: abertoEm || null,
    fechadoEm: fechadoEm || null
  };
}

const CaixaProvider = {
  id: 'caixa',

  async collect() {
    const inicio = Date.now();
    const warnings = [];
    const errors = [];
    try {
      const aberto = await obterSessaoAberta();
      if (!aberto) {
        const vazio = montarBlocoCaixa({
          abertura: 0, entradas: 0, sangrias: 0, suprimentos: 0,
          fechamento: null, status: 'fechado'
        });
        warnings.push('caixa: nenhuma sessão aberta');
        return criarMonitoringResult({
          success: true,
          source: 'CaixaProvider',
          metrics: { tempoConsultaMs: Date.now() - inicio },
          data: { caixa: { fiscal: vazio, naoFiscal: { ...vazio, abertura: 0 } } },
          warnings,
          errors
        });
      }

      const row = aberto.row;
      const sessaoId = aberto.tipo === 'sessao' ? row.id : (row.sessao_id || null);
      const caixaId = aberto.tipo === 'caixa' ? row.id : (row.caixa_turno_id || row.caixa_id || null);
      const abertura = num(row.valor_abertura != null ? row.valor_abertura : row.valor_inicial);
      const fechamento = row.valor_fechamento != null ? num(row.valor_fechamento) : null;

      const exprF = getExprValorVendaFiscal();
      const exprNf = getExprValorVendaNaoFiscal();

      const [vendasF, vendasNf, sangrias, suprimentos] = await Promise.all([
        sumVendasSessao(exprF, sessaoId, caixaId),
        sumVendasSessao(exprNf, sessaoId, caixaId),
        sumMovimentacoes('sangria', sessaoId, caixaId),
        sumMovimentacoes('suprimento', sessaoId, caixaId)
      ]);

      const sang = num(sangrias.total);
      const supr = num(suprimentos.total);
      // Movimentos de dinheiro físico atribuídos ao caixa fiscal; NF só vendas NF
      const fiscal = montarBlocoCaixa({
        abertura,
        entradas: num(vendasF.total),
        sangrias: sang,
        suprimentos: supr,
        fechamento,
        status: row.status,
        sessaoId: sessaoId || caixaId,
        abertoEm: row.aberto_em || null,
        fechadoEm: row.fechado_em || null
      });
      const naoFiscal = montarBlocoCaixa({
        abertura: 0,
        entradas: num(vendasNf.total),
        sangrias: 0,
        suprimentos: 0,
        fechamento: null,
        status: row.status,
        sessaoId: sessaoId || caixaId,
        abertoEm: row.aberto_em || null,
        fechadoEm: row.fechado_em || null
      });

      return criarMonitoringResult({
        success: true,
        source: 'CaixaProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: { caixa: { fiscal, naoFiscal } },
        warnings,
        errors
      });
    } catch (err) {
      errors.push(err.message || String(err));
      const vazio = montarBlocoCaixa({
        abertura: 0, entradas: 0, sangrias: 0, suprimentos: 0, fechamento: null, status: 'erro'
      });
      return criarMonitoringResult({
        success: false,
        source: 'CaixaProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: { caixa: { fiscal: vazio, naoFiscal: vazio } },
        warnings,
        errors
      });
    }
  }
};

module.exports = CaixaProvider;
