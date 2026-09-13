/**
 * IRepository — Contrato abstrato para repositories do MIIP.
 *
 * Todo repository em `repositories/` DEVE estender esta classe
 * e implementar os métodos obrigatórios.
 *
 * Sprint 2.1: contrato abstrato implementado pelos repositories MIIP.
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

  /**
   * Código único do repository (ex.: miip_associacoes).
   *
   * @abstract
   * @returns {string}
   */
  getCodigo() {
    throw new Error(`${this.constructor.name} deve implementar getCodigo()`);
  }

  /**
   * Descrição legível da responsabilidade do repository.
   *
   * @abstract
   * @returns {string}
   */
  getDescricao() {
    throw new Error(`${this.constructor.name} deve implementar getDescricao()`);
  }

  /**
   * Busca registro por identificador.
   *
   * @abstract
   * @param {number|string} _id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(_id) {
    throw new Error(`${this.constructor.name} deve implementar buscarPorId()`);
  }

  /**
   * Lista registros com filtros opcionais.
   *
   * @abstract
   * @param {Object} [_filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(_filtros) {
    throw new Error(`${this.constructor.name} deve implementar listar()`);
  }

  /**
   * Insere novo registro.
   *
   * @abstract
   * @param {Object} _dados
   * @returns {Promise<Object>}
   */
  async inserir(_dados) {
    throw new Error(`${this.constructor.name} deve implementar inserir()`);
  }

  /**
   * Atualiza registro existente.
   *
   * @abstract
   * @param {number|string} _id
   * @param {Object} _dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(_id, _dados) {
    throw new Error(`${this.constructor.name} deve implementar atualizar()`);
  }

  /**
   * Remove registro.
   *
   * @abstract
   * @param {number|string} _id
   * @returns {Promise<boolean>}
   */
  async remover(_id) {
    throw new Error(`${this.constructor.name} deve implementar remover()`);
  }

  /**
   * Retorna metadados estruturais do repository.
   *
   * @returns {{ codigo: string, descricao: string }}
   */
  getMetadados() {
    return {
      codigo: this.getCodigo(),
      descricao: this.getDescricao()
    };
  }

  /**
   * Valida se uma classe estende IRepository corretamente.
   *
   * @param {Function} ClasseRepository
   * @returns {{ valido: boolean, erros: string[] }}
   */
  static validarHeranca(ClasseRepository) {
    const erros = [];

    if (!ClasseRepository || typeof ClasseRepository !== 'function') {
      return { valido: false, erros: ['Classe de repository inválida'] };
    }

    if (ClasseRepository === IRepository) {
      return { valido: false, erros: ['IRepository não pode ser registrada como implementação'] };
    }

    let prototipo = ClasseRepository.prototype;
    let herdaBase = false;
    while (prototipo) {
      if (prototipo === IRepository.prototype) {
        herdaBase = true;
        break;
      }
      prototipo = Object.getPrototypeOf(prototipo);
    }

    if (!herdaBase) {
      erros.push('Repository deve estender IRepository');
    }

    let instancia;
    try {
      instancia = new ClasseRepository({});
    } catch (error) {
      erros.push(`Não foi possível instanciar repository: ${error.message}`);
      return { valido: false, erros };
    }

    METODOS_OBRIGATORIOS.forEach((metodo) => {
      if (typeof instancia[metodo] !== 'function') {
        erros.push(`Método obrigatório ausente: ${metodo}()`);
      }
    });

    return { valido: erros.length === 0, erros };
  }
}

IRepository.METODOS_OBRIGATORIOS = METODOS_OBRIGATORIOS;

module.exports = IRepository;
