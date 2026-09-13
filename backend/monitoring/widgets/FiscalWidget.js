const { criarWidget } = require('./widgetContract');
const { num, percentual } = require('../monitoringDateHelpers');

function formatMoneyLabel(v) {
  return num(v);
}

function blocoParaMetrics(bloco, extras = {}) {
  const b = bloco || {};
  const hoje = b.hoje || { valor: b.valor || 0, quantidade: b.quantidade || 0 };
  const mes = b.mes || { valor: 0, quantidade: 0 };
  const ano = b.ano || { valor: 0, quantidade: 0 };
  return {
    valor: num(b.valor != null ? b.valor : hoje.valor),
    quantidade: num(b.quantidade != null ? b.quantidade : hoje.quantidade),
    hoje,
    mes,
    ano,
    percentual: b.percentual != null ? num(b.percentual) : percentual(hoje.valor, mes.valor),
    ultimoLancamento: b.ultimoLancamento || extras.ultimoLancamento || null,
    fornecedor: extras.fornecedor || b.fornecedor || null
  };
}

function trendFromBlocos(hoje, mes) {
  const h = num(hoje?.valor);
  const m = num(mes?.valor);
  if (m <= 0) return h > 0 ? 'up' : 'flat';
  const mediaDia = m / Math.max(1, new Date().getDate());
  if (h > mediaDia * 1.05) return 'up';
  if (h < mediaDia * 0.95) return 'down';
  return 'flat';
}

/**
 * @param {Object} data — payload fiscal do summary (fiscal + naoFiscal)
 * @param {string} [updatedAt]
 * @param {Object} [opts]
 * @param {string} [opts.competenciaLabel]
 */
function buildFiscalWidgets(data = {}, updatedAt, opts = {}) {
  const fiscal = data.fiscal || {};
  const naoFiscal = data.naoFiscal || {};
  const indicadores = data.indicadoresFiscais || fiscal.indicadoresFiscais || {};
  const competenciaLabel = opts.competenciaLabel
    || indicadores.competenciaLabel
    || 'competência';
  const widgets = [];

  const vf = fiscal.vendas || {};
  widgets.push(criarWidget({
    id: 'fiscal.vendas',
    domain: 'fiscal',
    scope: 'fiscal',
    title: 'Vendas Fiscais',
    icon: 'fa-credit-card',
    badge: 'Fiscal',
    value: formatMoneyLabel(vf.mes?.valor ?? vf.valor),
    subtitle: `${num(vf.mes?.quantidade ?? vf.quantidade)} operações (${competenciaLabel})`,
    trend: trendFromBlocos(vf.hoje || vf, vf.mes),
    updatedAt,
    metrics: blocoParaMetrics(vf)
  }));

  const vnf = naoFiscal.vendas || {};
  widgets.push(criarWidget({
    id: 'fiscal.vendas_nao_fiscal',
    domain: 'fiscal',
    scope: 'nao_fiscal',
    title: 'Vendas Não Fiscais',
    icon: 'fa-money-bill',
    badge: 'Não Fiscal',
    value: formatMoneyLabel(vnf.mes?.valor ?? vnf.valor),
    subtitle: `${num(vnf.mes?.quantidade ?? vnf.quantidade)} operações (${competenciaLabel})`,
    trend: trendFromBlocos(vnf.hoje || vnf, vnf.mes),
    updatedAt,
    metrics: blocoParaMetrics(vnf)
  }));

  const ef = fiscal.entradas || {};
  widgets.push(criarWidget({
    id: 'fiscal.entradas',
    domain: 'fiscal',
    scope: 'fiscal',
    title: 'Entradas NF Fiscal',
    icon: 'fa-download',
    badge: 'Fiscal',
    value: formatMoneyLabel(ef.mes?.valor ?? ef.valor),
    subtitle: `${num(ef.mes?.quantidade ?? ef.quantidade)} documentos (${competenciaLabel})`,
    trend: trendFromBlocos(ef.hoje || ef, ef.mes),
    updatedAt,
    metrics: blocoParaMetrics(ef, { ultimoLancamento: ef.ultimaNf, fornecedor: ef.fornecedor })
  }));

  const enf = naoFiscal.entradas || {};
  widgets.push(criarWidget({
    id: 'fiscal.entradas_nao_fiscal',
    domain: 'fiscal',
    scope: 'nao_fiscal',
    title: 'Entradas NF Não Fiscal',
    icon: 'fa-box',
    badge: 'Não Fiscal',
    value: formatMoneyLabel(enf.mes?.valor ?? enf.valor),
    subtitle: `${num(enf.mes?.quantidade ?? enf.quantidade)} compras (${competenciaLabel})`,
    trend: trendFromBlocos(enf.hoje || enf, enf.mes),
    updatedAt,
    metrics: blocoParaMetrics(enf, { ultimoLancamento: enf.ultimaNf, fornecedor: enf.fornecedor })
  }));

  if (indicadores.quantidadeNfeEmitidas != null) {
    widgets.push(criarWidget({
      id: 'fiscal.nfe_emitidas',
      domain: 'fiscal',
      scope: 'fiscal',
      title: 'NF-e Emitidas',
      icon: 'fa-file-invoice',
      badge: indicadores.ambienteLabel || 'NF-e',
      value: num(indicadores.quantidadeNfeEmitidas),
      subtitle: `Autorizadas · ${competenciaLabel} · ${indicadores.ambienteLabel || '—'}`,
      trend: 'flat',
      updatedAt,
      metrics: {
        quantidade: num(indicadores.quantidadeNfeEmitidas),
        competencia: indicadores.competencia,
        ambiente: indicadores.ambiente
      }
    }));
  }

  return widgets;
}

module.exports = { buildFiscalWidgets };
