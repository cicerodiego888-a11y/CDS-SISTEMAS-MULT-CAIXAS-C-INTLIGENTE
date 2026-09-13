/**
 * Catálogo oficial dos Web Services fiscais SEFAZ.
 *
 * Indexado por modelo × operação × ambiente × UF.
 *
 * Sprint F2 / RC1.1 — aceita WebServiceDefinition completa.
 * Consultado pelos runtimes via UrlResolver / FiscalWebServices.
 *
 * @module services/fiscal/core/WebServiceRegistry
 */

const {
  WebServiceDefinition,
  createWebServiceDefinition
} = require('./WebServiceDefinition');

class WebServiceRegistry {
  constructor() {
    /** @type {Map<string, Readonly<object>>} */
    this._entries = new Map();
  }

  /**
   * Chave canônica do catálogo.
   * @param {{ modelo: string, operacao: string, ambiente: string, uf: string }} criteria
   * @returns {string}
   */
  static buildKey({ modelo, operacao, ambiente, uf }) {
    return [modelo, operacao, ambiente, String(uf || '').toUpperCase()].join('|');
  }

  /**
   * @returns {number}
   */
  size() {
    return this._entries.size;
  }

  /**
   * @returns {boolean}
   */
  isEmpty() {
    return this._entries.size === 0;
  }

  /**
   * Registra uma definição de Web Service.
   *
   * @param {object|WebServiceDefinition} definition
   * @param {{ overwrite?: boolean }} [options]
   * @returns {WebServiceRegistry}
   */
  register(definition, options = {}) {
    const overwrite = options.overwrite === true;
    const normalized = definition instanceof WebServiceDefinition
      ? definition.toJSON()
      : createWebServiceDefinition(definition);

    const key = WebServiceRegistry.buildKey(normalized);

    if (this._entries.has(key) && !overwrite) {
      throw new Error(
        `WebServiceRegistry: duplicidade para chave ${key}. Use overwrite: true para substituir.`
      );
    }

    this._entries.set(key, normalized);
    return this;
  }

  /**
   * Busca por critérios canônicos.
   * @param {{ modelo: string, operacao: string, ambiente: string, uf: string }} criteria
   * @returns {Readonly<object>|null}
   */
  get(criteria) {
    if (!criteria) return null;
    const key = WebServiceRegistry.buildKey(criteria);
    return this._entries.get(key) || null;
  }

  /**
   * Busca por id canônico.
   * @param {string} id
   * @returns {Readonly<object>|null}
   */
  getById(id) {
    if (!id) return null;
    for (const def of this._entries.values()) {
      if (def.id === id) return def;
    }
    return null;
  }

  /**
   * Filtra definições.
   * @param {object} [filter]
   * @returns {Readonly<object>[]}
   */
  find(filter = {}) {
    return this.list().filter((def) => {
      if (filter.modelo && def.modelo !== filter.modelo) return false;
      if (filter.operacao && def.operacao !== filter.operacao) return false;
      if (filter.ambiente && def.ambiente !== filter.ambiente) return false;
      if (filter.uf && def.uf !== String(filter.uf).toUpperCase()) return false;
      if (filter.ativo !== undefined && def.ativo !== Boolean(filter.ativo)) return false;
      return true;
    });
  }

  /**
   * @returns {Readonly<object>[]}
   */
  list() {
    return Array.from(this._entries.values());
  }

  /**
   * Lista apenas serviços ativos.
   * @returns {Readonly<object>[]}
   */
  listActive() {
    return this.find({ ativo: true });
  }

  /**
   * @returns {void}
   */
  clear() {
    this._entries.clear();
  }

  /**
   * Indica se a chave já existe.
   * @param {{ modelo: string, operacao: string, ambiente: string, uf: string }} criteria
   * @returns {boolean}
   */
  has(criteria) {
    return this._entries.has(WebServiceRegistry.buildKey(criteria));
  }
}

module.exports = {
  WebServiceRegistry
};
