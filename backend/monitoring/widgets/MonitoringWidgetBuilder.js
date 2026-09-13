/**
 * MonitoringWidgetBuilder — transforma dados de Providers em Widgets oficiais.
 * Desacoplado: não consulta banco; não conhece SQL; só DTO → Widget.
 */

const { buildFiscalWidgets } = require('./FiscalWidget');
const { buildFinanceiroWidgets } = require('./FinanceiroWidget');
const { buildCaixaWidgets } = require('./CaixaWidget');
const { buildRecebimentosWidgets } = require('./RecebimentosWidget');
const { buildTefWidgets } = require('./TefWidget');

class MonitoringWidgetBuilder {
  /**
   * @param {Object} payload — dados agregados dos providers
   * @param {{ updatedAt?: string }} [opcoes]
   * @returns {Array<Object>}
   */
  build(payload = {}, opcoes = {}) {
    const updatedAt = opcoes.updatedAt || new Date().toISOString();
    return [
      ...buildFiscalWidgets(payload, updatedAt, {
        competenciaLabel: opcoes.competenciaLabel
      }),
      ...buildFinanceiroWidgets(payload, updatedAt),
      ...buildCaixaWidgets(payload, updatedAt),
      ...buildRecebimentosWidgets(payload, updatedAt),
      ...buildTefWidgets(payload, updatedAt)
    ];
  }

  /**
   * Filtra widgets por domínio e/ou escopo (utilitário para consumidores).
   */
  static filter(widgets, { domain, scope, includeNaoFiscal } = {}) {
    return (widgets || []).filter((w) => {
      if (domain && w.domain !== domain) return false;
      if (scope && w.scope !== scope) return false;
      if (includeNaoFiscal === false && w.scope === 'nao_fiscal') return false;
      return true;
    });
  }
}

module.exports = {
  MonitoringWidgetBuilder,
  monitoringWidgetBuilder: new MonitoringWidgetBuilder()
};
