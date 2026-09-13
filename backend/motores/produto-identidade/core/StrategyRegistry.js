/**
 * StrategyRegistry — registro de strategies MIP (Sprint 02).
 * @module motores/produto-identidade/core/StrategyRegistry
 */

class StrategyRegistry {
  constructor() {
    /** @type {Map<string, import('../strategies/IdentidadeStrategyBase')>} */
    this._map = new Map();
  }

  /**
   * @param {import('../strategies/IdentidadeStrategyBase')} strategy
   */
  registrar(strategy) {
    if (!strategy || typeof strategy.nome !== 'string') {
      throw new Error('Strategy inválida para registro');
    }
    this._map.set(strategy.nome, strategy);
    return this;
  }

  /**
   * @param {string} nome
   * @returns {import('../strategies/IdentidadeStrategyBase')|null}
   */
  obter(nome) {
    return this._map.get(nome) || null;
  }

  /**
   * @returns {import('../strategies/IdentidadeStrategyBase')[]}
   */
  listar() {
    return [...this._map.values()];
  }

  /**
   * Strategies que aceitam a entrada, na ordem do registry (inserção).
   * @param {string} codigo
   * @param {Object} contexto
   * @param {Object} deteccao
   * @returns {import('../strategies/IdentidadeStrategyBase')[]}
   */
  filtrarCompativeis(codigo, contexto, deteccao) {
    return this.listar().filter((s) => {
      try {
        return s.canHandle(codigo, contexto, deteccao) === true;
      } catch {
        return false;
      }
    });
  }

  limpar() {
    this._map.clear();
  }

  get tamanho() {
    return this._map.size;
  }
}

module.exports = StrategyRegistry;
