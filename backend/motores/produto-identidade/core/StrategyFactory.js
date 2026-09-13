/**
 * StrategyFactory — registry padrão MIP (Sprint 02 + 04 etiqueta).
 * @module motores/produto-identidade/core/StrategyFactory
 */

const StrategyRegistry = require('./StrategyRegistry');
const InternoStrategy = require('../strategies/InternoStrategy');
const IdStrategy = require('../strategies/IdStrategy');
const Ean13Strategy = require('../strategies/Ean13Strategy');
const GtinStrategy = require('../strategies/GtinStrategy');
const EtiquetaBalancaStrategy = require('../strategies/EtiquetaBalancaStrategy');
const PluStrategy = require('../strategies/PluStrategy');
const LayoutRegistry = require('../layouts/LayoutRegistry');

class StrategyFactory {
  /**
   * @param {Object} [deps]
   * @param {Object} [deps.catalogo]
   * @param {Object} [deps.db]
   * @param {LayoutRegistry} [deps.layoutRegistry]
   * @returns {StrategyRegistry}
   */
  static criarRegistryPadrao(deps = {}) {
    const registry = new StrategyRegistry();
    const catalogo = deps.catalogo || null;
    const layoutRegistry = deps.layoutRegistry || LayoutRegistry.criarPadrao();

    // Etiqueta balança antes de EAN13 (ambos têm 13 dígitos)
    registry.registrar(new EtiquetaBalancaStrategy({
      catalogo,
      layoutRegistry,
      db: deps.db || null
    }));
    registry.registrar(new GtinStrategy({ catalogo }));
    registry.registrar(new Ean13Strategy({ catalogo }));
    registry.registrar(new PluStrategy({ catalogo }));
    registry.registrar(new IdStrategy({ catalogo }));
    registry.registrar(new InternoStrategy({ catalogo }));

    return registry;
  }
}

module.exports = StrategyFactory;
