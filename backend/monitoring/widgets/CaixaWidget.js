const { criarWidget } = require('./widgetContract');
const { num } = require('../monitoringDateHelpers');

function buildCaixaCard(id, title, scope, badge, bloco, updatedAt) {
  const b = bloco || {};
  const saldo = num(b.saldo);
  return criarWidget({
    id,
    domain: 'caixa',
    scope,
    title,
    icon: 'fa-university',
    badge,
    value: saldo,
    subtitle: `Entradas ${num(b.entradas)} · Saídas ${num(b.saidas)}`,
    trend: saldo >= 0 ? 'up' : 'down',
    updatedAt,
    metrics: {
      saldo,
      entradas: num(b.entradas),
      saidas: num(b.saidas),
      suprimentos: num(b.suprimentos),
      sangrias: num(b.sangrias),
      abertura: num(b.abertura),
      fechamento: b.fechamento != null ? num(b.fechamento) : null,
      status: b.status || null,
      sessaoId: b.sessaoId || null,
      abertoEm: b.abertoEm || null,
      fechadoEm: b.fechadoEm || null
    }
  });
}

function buildCaixaWidgets(data = {}, updatedAt) {
  const caixa = data.caixa || {};
  return [
    buildCaixaCard('caixa.fiscal', 'Caixa Fiscal', 'fiscal', 'Caixa', caixa.fiscal, updatedAt),
    buildCaixaCard('caixa.nao_fiscal', 'Caixa Não Fiscal', 'nao_fiscal', 'Caixa', caixa.naoFiscal, updatedAt)
  ];
}

module.exports = { buildCaixaWidgets };
