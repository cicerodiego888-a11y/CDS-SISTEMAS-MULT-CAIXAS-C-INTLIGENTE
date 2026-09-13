/**
 * MonitoringTrendService — tendências (Hoje/Ontem/Semana/Mês).
 * Somente interpretação; não altera Providers.
 */

const db = require('../../database');
const { FILTRO_VENDA_VALIDA, getExprValorVendaFiscal } = require('../../services/reportFiscalHelpers');
const { dataHojeBrasil, num, dbGetFactory } = require('../monitoringDateHelpers');

const dbGet = dbGetFactory(db);

function calcVariacao(atual, anterior) {
  const a = num(atual);
  const b = num(anterior);
  if (b <= 0) {
    if (a > 0) return { pct: 100, direction: 'up' };
    return { pct: 0, direction: 'flat' };
  }
  const pct = Math.round(((a - b) / b) * 1000) / 10;
  let direction = 'flat';
  if (pct > 2) direction = 'up';
  else if (pct < -2) direction = 'down';
  return { pct, direction };
}

function trendLabel(direction) {
  if (direction === 'up') return '▲ Crescimento';
  if (direction === 'down') return '▼ Queda';
  return '▬ Estável';
}

async function sumVendasFiscal(dataStr) {
  const expr = getExprValorVendaFiscal();
  const row = await dbGet(
    `SELECT COALESCE(SUM(${expr}), 0) AS valor, COUNT(CASE WHEN COALESCE(${expr}, 0) > 0 THEN 1 END) AS qtd
     FROM vendas v WHERE date(v.data_venda) = date(?) AND ${FILTRO_VENDA_VALIDA}`,
    [dataStr]
  );
  return { valor: num(row.valor), quantidade: num(row.qtd) };
}

function offsetData(isoDate, dias) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

class MonitoringTrendService {
  /**
   * @param {Object} payload — summary agregado dos providers
   */
  async analyze(payload = {}) {
    const hojeStr = dataHojeBrasil();
    const ontemStr = offsetData(hojeStr, -1);
    const semanaInicio = offsetData(hojeStr, -6);

    const [hojeDb, ontemDb] = await Promise.all([
      sumVendasFiscal(hojeStr),
      sumVendasFiscal(ontemStr)
    ]);

    const vendasPayload = payload.fiscal?.vendas || {};
    const hoje = {
      valor: num(vendasPayload.hoje?.valor ?? hojeDb.valor),
      quantidade: num(vendasPayload.hoje?.quantidade ?? hojeDb.quantidade)
    };
    const ontem = ontemDb;
    const semana = {
      valor: num(vendasPayload.mes?.valor) > 0 ? num(vendasPayload.mes?.valor) / Math.max(1, new Date().getDate()) * 7 : hoje.valor * 7,
      quantidade: num(vendasPayload.mes?.quantidade)
    };
    const mes = {
      valor: num(vendasPayload.mes?.valor),
      quantidade: num(vendasPayload.mes?.quantidade)
    };

    const vsOntem = calcVariacao(hoje.valor, ontem.valor);
    const vsSemana = calcVariacao(hoje.valor, semana.valor / 7);
    const vsMes = calcVariacao(hoje.valor, mes.valor / Math.max(1, new Date().getDate()));

    const domains = {};

    const fiscalTrend = {
      hoje,
      ontem,
      semana: { inicio: semanaInicio, fim: hojeStr, ...semana },
      mes,
      variacao: {
        vsOntem,
        vsSemana,
        vsMes
      },
      label: trendLabel(vsOntem.direction)
    };
    domains.fiscal = fiscalTrend;

    const caixaF = payload.caixa?.fiscal || {};
    const caixaNf = payload.caixa?.naoFiscal || {};
    domains.caixa = {
      fiscal: { saldo: num(caixaF.saldo), label: num(caixaF.saldo) >= 0 ? trendLabel('flat') : trendLabel('down') },
      naoFiscal: { saldo: num(caixaNf.saldo), label: trendLabel('flat') }
    };

    return {
      global: fiscalTrend,
      domains,
      updatedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  MonitoringTrendService,
  calcVariacao,
  trendLabel
};
