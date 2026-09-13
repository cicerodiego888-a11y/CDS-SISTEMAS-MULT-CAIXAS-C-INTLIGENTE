/**
 * IRepository — Contrato abstrato para repositories da Central de Entradas.
 *
 * @abstract
 * @class IRepository
 */

const METODOS_OBRIGATORIOS = Object.freeze([
  'getCodigo',
  'getDescricao',
  'buscarPorId',
  'listar',
  'inserir',
  'atualizar',
  'remover'
]);

class IRepository {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    if (new.target === IRepository) {
      throw new Error('IRepository é abstrata e não pode ser instanciada diretamente');
    }
    this.config = config || {};
  }

  /** @abstract @returns {string} */
  getCodigo() {
    throw new Error(`${this.constructor.name} deve implementar getCodigo()`);
  }

  /** @abstract @returns {string} */
  getDescricao() {
    throw new Error(`${this.constructor.name} deve implementar getDescricao()`);
  }

  /** @abstract @returns {Promise<Object|null>} */
  async buscarPorId(_id) {
    throw new Error(`${this.constructor.name} deve implementar buscarPorId()`);
  }

  /** @abstract @returns {Promise<Object[]>} */
  async listar(_filtros) {
    throw new Error(`${this.constructor.name} deve implementar listar()`);
  }

  /** @abstract @returns {Promise<Object>} */
  async inserir(_dados) {
    throw new Error(`${this.constructor.name} deve implementar inserir()`);
  }

  /** @abstract @returns {Promise<Object|null>} */
  async atualizar(_id, _dados) {
    throw new Error(`${this.constructor.name} deve implementar atualizar()`);
  }

  /** @abstract @returns {Promise<boolean>} */
  async remover(_id) {
    throw new Error(`${this.constructor.name} deve implementar remover()`);
  }

  /**
   * @returns {{ codigo: string, descricao: string }}
   */
  getMetadados() {
    return {
      codigo: this.getCodigo(),
      descricao: this.getDescricao()
    };
  }
}

IRepository.METODOS_OBRIGATORIOS = METODOS_OBRIGATORIOS;

module.exports = IRepository;
