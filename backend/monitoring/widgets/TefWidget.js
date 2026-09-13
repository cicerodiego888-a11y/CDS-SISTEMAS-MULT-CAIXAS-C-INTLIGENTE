const { criarWidget } = require('./widgetContract');
const { num } = require('../monitoringDateHelpers');

/**
 * TEF — estrutura M2 com mock (sem SDK).
 */
function buildTefWidgets(data = {}, updatedAt) {
  const tef = data.tef || {};
  const aprovadas = num(tef.aprovadas);
  const negadas = num(tef.negadas);
  const valor = num(tef.valorAprovado);
  return [
    criarWidget({
      id: 'tef.resumo',
      domain: 'recebimentos',
      scope: 'fiscal',
      title: 'TEF (mock)',
      icon: 'fa-cash-register',
      badge: 'Mock',
      value: valor,
      subtitle: `${aprovadas} aprovadas · ${negadas} negadas`,
      trend: 'flat',
      updatedAt,
      metrics: {
        aprovadas,
        negadas,
        valorAprovado: valor,
        pendentes: num(tef.pendentes),
        mock: true,
        mensagem: tef.mensagem || 'Estrutura TEF preparada — sem integração SDK nesta sprint.'
      },
      meta: { stub: true, sdk: false }
    }),
    criarWidget({
      id: 'tef.nao_fiscal',
      domain: 'recebimentos',
      scope: 'nao_fiscal',
      title: 'TEF Não Fiscal (mock)',
      icon: 'fa-cash-register',
      badge: 'Mock',
      value: num(tef.valorNaoFiscal),
      subtitle: 'Reservado para conciliação não fiscal',
      trend: 'flat',
      updatedAt,
      metrics: {
        valorAprovado: num(tef.valorNaoFiscal),
        mock: true
      },
      meta: { stub: true, sdk: false }
    })
  ];
}

module.exports = { buildTefWidgets };
