'use strict';

/**
 * Contrato oficial de Search Provider (MIB-RC3.0).
 * Toda entidade pesquisável implementa esta interface.
 *
 * @typedef {object} SearchContext
 * @property {number} [limite]
 * @property {number} [operador_id]
 * @property {number} [filial_id]
 * @property {number} [caixa_id]
 * @property {string} [origem]
 * @property {string[]} [permissoes]
 * @property {string} [perfil]
 * @property {string} [role]
 * @property {boolean} [modoFiscal]
 * @property {object} [user]
 */

/**
 * @interface ISearchProvider
 */
class ISearchProvider {
  /** @returns {string} */
  get entity() {
    throw new Error('entity não implementado');
  }

  /** @returns {string[]} aliases de entidade */
  get aliases() {
    return [];
  }

  /** Permissão mínima (ex.: 'produtos', 'clientes') */
  get permissao() {
    return null;
  }

  /**
   * @param {SearchContext} ctx
   * @returns {boolean}
   */
  autorizar(ctx) {
    return true;
  }

  /**
   * @param {string} query
   * @param {SearchContext} ctx
   * @returns {Promise<{ itens: object[], meta?: object }>}
   */
  async search(query, ctx) {
    throw new Error('search não implementado');
  }

  /**
   * Índices SQL recomendados para a entidade.
   * @returns {{ tabela: string, indices: string[] }}
   */
  indexSpec() {
    return { tabela: null, indices: [] };
  }
}

module.exports = ISearchProvider;
