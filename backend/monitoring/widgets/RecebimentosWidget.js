const { criarWidget } = require('./widgetContract');
const { num, percentual } = require('../monitoringDateHelpers');

function metricsFrom(bloco) {
  const b = bloco || {};
  const hoje = b.hoje || { valor: 0, quantidade: 0 };
  const mes = b.mes || { valor: 0, quantidade: 0 };
  const ano = b.ano || { valor: 0, quantidade: 0 };
  return {
    valor: num(b.valor != null ? b.valor : hoje.valor),
    quantidade: num(b.quantidade != null ? b.quantidade : hoje.quantidade),
    hoje,
    mes,
    ano,
    percentual: b.percentual != null ? num(b.percentual) : percentual(hoje.valor, mes.valor),
    ultimoLancamento: b.ultimoLancamento || null
  };
}

function buildRecebimentoWidget(id, title, icon, scope, badge, bloco, updatedAt) {
  const m = metricsFrom(bloco);
  return criarWidget({
    id,
    domain: 'recebimentos',
    scope,
    title,
    icon,
    badge,
    value: m.valor,
    subtitle: `${m.quantidade} recebimentos (hoje)`,
    trend: m.percentual >= 40 ? 'up' : 'flat',
    updatedAt,
    metrics: m
  });
}

function buildRecebimentosWidgets(data = {}, updatedAt) {
  const r = data.recebimentos || {};
  return [
    buildRecebimentoWidget('recebimentos.pix_fiscal', 'PIX Fiscal', 'fa-qrcode', 'fiscal', 'PIX', r.pixFiscal, updatedAt),
    buildRecebimentoWidget('recebimentos.dinheiro_fiscal', 'Dinheiro Fiscal', 'fa-money-bill-wave', 'fiscal', 'Dinheiro', r.dinheiroFiscal, updatedAt),
    buildRecebimentoWidget('recebimentos.cartao_fiscal', 'Cartão Fiscal', 'fa-credit-card', 'fiscal', 'Cartão', r.cartaoFiscal, updatedAt),
    buildRecebimentoWidget('recebimentos.pix_nao_fiscal', 'PIX Não Fiscal', 'fa-qrcode', 'nao_fiscal', 'PIX', r.pixNaoFiscal, updatedAt),
    buildRecebimentoWidget('recebimentos.dinheiro_nao_fiscal', 'Dinheiro Não Fiscal', 'fa-money-bill-wave', 'nao_fiscal', 'Dinheiro', r.dinheiroNaoFiscal, updatedAt),
    buildRecebimentoWidget('recebimentos.cartao_nao_fiscal', 'Cartão Não Fiscal', 'fa-credit-card', 'nao_fiscal', 'Cartão', r.cartaoNaoFiscal, updatedAt)
  ];
}

module.exports = { buildRecebimentosWidgets };
