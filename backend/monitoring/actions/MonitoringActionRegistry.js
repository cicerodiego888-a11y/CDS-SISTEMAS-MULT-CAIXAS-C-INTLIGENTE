/**
 * Registry de ações por domínio — COP Action Center.
 * Insights/Providers NÃO registram páginas; só o Action Center.
 */

class MonitoringActionRegistry {
  constructor() {
    /** @type {Map<string, Object[]>} signalId → action templates */
    this._bySignal = new Map();
    /** @type {Map<string, Object[]>} domain → templates */
    this._byDomain = new Map();
  }

  /**
   * @param {string} signalId — id de alerta/insight/recomendação
   * @param {Object|Object[]} templates — action DTOs parciais
   */
  register(signalId, templates) {
    if (!signalId) throw new Error('MonitoringActionRegistry: signalId obrigatório');
    const list = Array.isArray(templates) ? templates : [templates];
    const existing = this._bySignal.get(signalId) || [];
    this._bySignal.set(signalId, existing.concat(list));
    list.forEach((t) => {
      const d = t.dominio || t.domain || t.category || 'geral';
      const arr = this._byDomain.get(d) || [];
      arr.push({ signalId, ...t });
      this._byDomain.set(d, arr);
    });
    return this;
  }

  getBySignal(signalId) {
    return this._bySignal.get(signalId) || [];
  }

  getByDomain(domain) {
    return this._byDomain.get(domain) || [];
  }

  listSignals() {
    return Array.from(this._bySignal.keys());
  }

  clear() {
    this._bySignal.clear();
    this._byDomain.clear();
  }
}

module.exports = { MonitoringActionRegistry };
