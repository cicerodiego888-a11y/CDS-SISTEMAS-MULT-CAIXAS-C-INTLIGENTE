/**
 * MotorRegistry — Registro central de engines de identificação.
 *
 * Mantém mapa de motores plugáveis com metadados completos.
 * Permite habilitar/desabilitar engines sem alterar código.
 *
 * Sprint 1.1: metadados estendidos e toggle ativo/inativo.
 *
 * @class MotorRegistry
 */

const IMotorIdentificacao = require('./IMotorIdentificacao');

/**
 * @typedef {Object} MotorRegistroDTO
 * @property {string} codigo
 * @property {string} descricao
 * @property {string} versao
 * @property {number} prioridade
 * @property {boolean} ativo
 * @property {string} autor
 * @property {string} dataCriacao
 * @property {typeof IMotorIdentificacao} Classe
 * @property {IMotorIdentificacao} instancia
 * @property {Object} meta
 * @property {string} registradoEm
 */

class MotorRegistry {
  constructor() {
    /** @private @type {Map<string, MotorRegistroDTO>} */
    this._registro = new Map();
  }

  /**
   * Registra um engine de identificação.
   *
   * @param {Object} entrada
   * @param {string} entrada.codigo - Código único do engine
   * @param {typeof IMotorIdentificacao} [entrada.Classe] - Classe do engine
   * @param {IMotorIdentificacao|Object} [entrada.instancia] - Instância pronta (opcional)
   * @param {string} [entrada.descricao] - Descrição legível da estratégia
   * @param {string} [entrada.versao='1.0.0'] - Versão semver do motor
   * @param {boolean} [entrada.ativo=true] - Se o engine participa do pipeline
   * @param {number} [entrada.prioridade=100] - Ordem de execução (menor = primeiro)
   * @param {string} [entrada.autor='CDS'] - Autor ou equipe responsável
   * @param {string} [entrada.dataCriacao] - ISO 8601 de criação do motor
   * @param {Object} [entrada.meta] - Metadados adicionais (config, tags, etc.)
   * @returns {MotorRegistroDTO}
   */
  registrar(entrada) {
    const {
      codigo,
      Classe,
      instancia = null,
      descricao = '',
      versao = '1.0.0',
      ativo = true,
      prioridade = 100,
      autor = 'CDS',
      dataCriacao = null,
      meta = {}
    } = entrada || {};

    if (!codigo) {
      throw new Error('codigo é obrigatório para registrar engine MIIP');
    }

    if (!Classe && !instancia) {
      throw new Error(`Engine ${codigo} requer Classe ou instancia`);
    }

    if (Classe) {
      const validacao = IMotorIdentificacao.validarHeranca(Classe);
      if (!validacao.valido) {
        throw new Error(`Engine inválido (${codigo}): ${validacao.erros.join('; ')}`);
      }
    }

    const engine = instancia || new Classe(meta.config || {});

    const registro = {
      codigo,
      descricao: descricao || (typeof engine.getDescricao === 'function' ? engine.getDescricao() : ''),
      versao: String(versao),
      prioridade: Number(prioridade),
      ativo: Boolean(ativo),
      autor: String(autor),
      dataCriacao: dataCriacao || new Date().toISOString(),
      Classe: Classe || engine.constructor,
      instancia: engine,
      meta,
      registradoEm: new Date().toISOString()
    };

    this._registro.set(codigo, registro);
    return registro;
  }

  /**
   * Remove um engine do registro.
   *
   * @param {string} codigo
   * @returns {boolean}
   */
  remover(codigo) {
    return this._registro.delete(codigo);
  }

  /**
   * Busca um engine pelo código.
   *
   * @param {string} codigo
   * @returns {MotorRegistroDTO|null}
   */
  buscar(codigo) {
    if (!codigo) return null;
    return this._registro.get(String(codigo)) || null;
  }

  /**
   * Lista todos os engines registrados.
   *
   * @returns {MotorRegistroDTO[]}
   */
  listar() {
    return [...this._registro.values()];
  }

  /**
   * Lista engines ativos ordenados por prioridade.
   *
   * @returns {MotorRegistroDTO[]}
   */
  listarAtivos() {
    return this._filtrarPorAtivo(true);
  }

  /**
   * Lista engines inativos ordenados por prioridade.
   *
   * @returns {MotorRegistroDTO[]}
   */
  listarInativos() {
    return this._filtrarPorAtivo(false);
  }

  /**
   * @private
   * @param {boolean} ativo
   * @returns {MotorRegistroDTO[]}
   */
  _filtrarPorAtivo(ativo) {
    return this.listar()
      .filter((item) => item.ativo === ativo)
      .sort((a, b) => a.prioridade - b.prioridade);
  }

  /**
   * Habilita um engine registrado.
   *
   * @param {string} codigo
   * @returns {boolean}
   */
  habilitar(codigo) {
    const item = this.buscar(codigo);
    if (!item) return false;
    item.ativo = true;
    return true;
  }

  /**
   * Desabilita um engine registrado.
   *
   * @param {string} codigo
   * @returns {boolean}
   */
  desabilitar(codigo) {
    const item = this.buscar(codigo);
    if (!item) return false;
    item.ativo = false;
    return true;
  }

  /**
   * Verifica se um engine está registrado e ativo.
   *
   * @param {string} codigo
   * @returns {boolean}
   */
  estaAtivo(codigo) {
    const item = this.buscar(codigo);
    return Boolean(item && item.ativo);
  }

  /**
   * Retorna metadados públicos de um engine (sem instância).
   *
   * @param {string} codigo
   * @returns {Object|null}
   */
  obterMetadados(codigo) {
    const item = this.buscar(codigo);
    if (!item) return null;

    return {
      codigo: item.codigo,
      descricao: item.descricao,
      versao: item.versao,
      prioridade: item.prioridade,
      ativo: item.ativo,
      autor: item.autor,
      dataCriacao: item.dataCriacao,
      registradoEm: item.registradoEm
    };
  }

  /**
   * Retorna quantidade de engines registrados.
   *
   * @returns {number}
   */
  total() {
    return this._registro.size;
  }

  /**
   * Retorna quantidade de engines ativos.
   *
   * @returns {number}
   */
  totalAtivos() {
    return this.listarAtivos().length;
  }
}

module.exports = new MotorRegistry();
module.exports.MotorRegistry = MotorRegistry;
