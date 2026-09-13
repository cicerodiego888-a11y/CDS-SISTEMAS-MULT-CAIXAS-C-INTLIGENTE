/**
 * CentralEntradasFlags — Feature flags do módulo Central Inteligente de Entradas.
 *
 * Sprint 1: fundação — flags placeholder para sprints futuras.
 *
 * @module motores/central-entradas/config/centralEntradasFlags
 */

class CentralEntradasFlags {
  constructor() {
    /** @private */
    this._moduloHabilitado = true;
    /** @private */
    this._syncAutomatica = false;
  }

  /**
   * Indica se o módulo Central de Entradas está habilitado.
   *
   * @returns {boolean}
   */
  estaHabilitado() {
    return this._moduloHabilitado !== false;
  }

  /**
   * Indica se a sincronização automática DF-e está habilitada (Sprint futura).
   *
   * @returns {boolean}
   */
  syncAutomaticaHabilitada() {
    return this._syncAutomatica === true;
  }

  /**
   * @param {boolean} valor
   * @returns {void}
   */
  definirModuloHabilitado(valor) {
    this._moduloHabilitado = Boolean(valor);
  }

  /**
   * @param {boolean} valor
   * @returns {void}
   */
  definirSyncAutomatica(valor) {
    this._syncAutomatica = Boolean(valor);
  }
}

module.exports = new CentralEntradasFlags();
