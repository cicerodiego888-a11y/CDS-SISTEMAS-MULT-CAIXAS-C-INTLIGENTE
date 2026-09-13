/**
 * LayoutRegistry — registro de parsers de etiqueta de balança (Sprint 04).
 * @module motores/produto-identidade/layouts/LayoutRegistry
 */

const LegadoCdsValor56Layout = require('./LegadoCdsValor56Layout');
const ToledoPrix4Valor55Layout = require('./ToledoPrix4Valor55Layout');
const ToledoPrix4PesoLayout = require('./ToledoPrix4PesoLayout');
const { LAYOUT_DEFAULT } = require('./layoutIds');

class LayoutRegistry {
  constructor() {
    /** @type {Map<string, import('./EtiquetaLayoutBase')>} */
    this._map = new Map();
  }

  /**
   * @param {import('./EtiquetaLayoutBase')} layout
   */
  registrar(layout) {
    if (!layout || typeof layout.id !== 'string') {
      throw new Error('Layout inválido');
    }
    this._map.set(layout.id, layout);
    return this;
  }

  /**
   * @param {string} id
   * @returns {import('./EtiquetaLayoutBase')|null}
   */
  obter(id) {
    return this._map.get(id) || null;
  }

  /**
   * @returns {import('./EtiquetaLayoutBase')[]}
   */
  listar() {
    return [...this._map.values()];
  }

  /**
   * Layout padrão (legado CDS) ou o solicitado; fallback seguro.
   * @param {string} [layoutId]
   */
  obterOuDefault(layoutId) {
    if (layoutId && this._map.has(layoutId)) {
      return this._map.get(layoutId);
    }
    return this._map.get(LAYOUT_DEFAULT) || this.listar()[0] || null;
  }

  get tamanho() {
    return this._map.size;
  }

  /**
   * @returns {LayoutRegistry}
   */
  static criarPadrao() {
    const registry = new LayoutRegistry();
    registry.registrar(new LegadoCdsValor56Layout());
    registry.registrar(new ToledoPrix4Valor55Layout());
    registry.registrar(new ToledoPrix4PesoLayout());
    return registry;
  }
}

module.exports = LayoutRegistry;
module.exports.LAYOUT_DEFAULT = LAYOUT_DEFAULT;
module.exports.LAYOUT_IDS = require('./layoutIds').LAYOUT_IDS;
