/**
 * MiipContext — Metadados de contexto para uma operação de identificação.
 *
 * Transporta informações sobre origem, usuário e sessão.
 * Não contém lógica de negócio nem acesso a banco.
 *
 * Sprint Core: objeto de valor — sem validação de regras de decisão.
 *
 * @class MiipContext
 */

/** Origens válidas de identificação. */
const ORIGENS = Object.freeze([
  'xml',
  'compra',
  'pdv',
  'api',
  'cloud',
  'indefinida'
]);

class MiipContext {
  /**
   * @param {Object} [dados]
   * @param {string} [dados.origem] - Origem do item
   * @param {number|null} [dados.usuarioId] - ID do usuário que disparou a operação
   * @param {string|null} [dados.sessaoId] - Identificador de sessão
   * @param {string|null} [dados.operacaoId] - UUID da operação
   * @param {string|null} [dados.timestamp] - ISO 8601 do momento da requisição
   */
  constructor(dados = {}) {
    this.origem = dados.origem ?? 'indefinida';
    this.usuarioId = dados.usuarioId ?? null;
    this.sessaoId = dados.sessaoId ?? null;
    this.operacaoId = dados.operacaoId ?? null;
    this.timestamp = dados.timestamp ?? null;
  }

  /**
   * Factory para criação explícita.
   *
   * @param {Object} [dados]
   * @returns {MiipContext}
   */
  static create(dados = {}) {
    return new MiipContext(dados);
  }

  /**
   * Cria contexto com timestamp atual em ISO 8601.
   *
   * @param {Object} [dados]
   * @returns {MiipContext}
   */
  static agora(dados = {}) {
    return new MiipContext({
      ...dados,
      timestamp: dados.timestamp ?? new Date().toISOString()
    });
  }

  /**
   * Verifica se a origem informada é válida estruturalmente.
   *
   * @param {string} origem
   * @returns {boolean}
   */
  static isOrigemValida(origem) {
    return typeof origem === 'string' && ORIGENS.includes(origem);
  }

  /**
   * @returns {string[]}
   */
  static origens() {
    return [...ORIGENS];
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      origem: this.origem,
      usuarioId: this.usuarioId,
      sessaoId: this.sessaoId,
      operacaoId: this.operacaoId,
      timestamp: this.timestamp
    };
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipContext}
   */
  static fromJSON(plain) {
    return new MiipContext(plain || {});
  }
}

MiipContext.ORIGENS = ORIGENS;

module.exports = MiipContext;
