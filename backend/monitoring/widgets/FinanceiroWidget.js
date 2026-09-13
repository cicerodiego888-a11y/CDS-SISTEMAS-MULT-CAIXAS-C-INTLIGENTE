const { criarWidget } = require('./widgetContract');
const { num, percentual } = require('../monitoringDateHelpers');

function metricsFrom(bloco) {
  const b = bloco || {};
  const hoje = b.hoje || { valor: 0, quantidade: 0 };
  const mes = b.mes || { valor: 0, quantidade: 0 };
  const ano = b.ano || { valor: 0, quantidade: 0 };
  return {
    valor: num(b.valor),
    quantidade: num(b.quantidade),
    hoje,
    mes,
    ano,
    percentual: b.percentual != null ? num(b.percentual) : percentual(hoje.valor, mes.valor),
    ultimoLancamento: b.ultimoLancamento || null
  };
}

function widgetFinanceiro(id, title, icon, scope, badge, bloco, updatedAt) {
  const m = metricsFrom(bloco);
  const ult = m.ultimoLancamento;
  const ultLabel = ult
    ? (ult.descricao || ult.numero || 'Lançamento') + (ult.data ? ` · ${String(ult.data).slice(0, 10)}` : '')
    : 'Sem lançamentos';
  return criarWidget({
    id,
    domain: 'financeiro',
    scope,
    title,
    icon,
    badge,
    value: m.valor,
    subtitle: `${m.quantidade} títulos · ${ultLabel}`,
    trend: m.percentual >= 50 ? 'up' : (m.percentual > 0 ? 'flat' : 'down'),
    updatedAt,
    metrics: m
  });
}

function buildFinanceiroWidgets(data = {}, updatedAt) {
  const fin = data.financeiro || {};
  return [
    widgetFinanceiro('financeiro.receber_fiscal', 'Receber Fiscal', 'fa-hand-holding-usd', 'fiscal', 'Receber', fin.receberFiscal, updatedAt),
    widgetFinanceiro('financeiro.pagar_fiscal', 'Pagar Fiscal', 'fa-file-invoice-dollar', 'fiscal', 'Pagar', fin.pagarFiscal, updatedAt),
    widgetFinanceiro('financeiro.receber_nao_fiscal', 'Receber Não Fiscal', 'fa-hand-holding-usd', 'nao_fiscal', 'Receber', fin.receberNaoFiscal, updatedAt),
    widgetFinanceiro('financeiro.pagar_nao_fiscal', 'Pagar Não Fiscal', 'fa-file-invoice-dollar', 'nao_fiscal', 'Pagar', fin.pagarNaoFiscal, updatedAt)
  ];
}

module.exports = { buildFinanceiroWidgets };
