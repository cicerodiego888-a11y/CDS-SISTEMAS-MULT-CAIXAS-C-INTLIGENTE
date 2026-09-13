/**
 * CanonicalToken — Token individual com metadados de normalização.
 *
 * Sprint 7.1
 *
 * @class CanonicalToken
 */

const TokenType = require('./TokenType');

class CanonicalToken {
  /**
   * @param {Object} [dados]
   * @param {string} dados.textoOriginal - Token antes da expansão canônica
   * @param {string} dados.textoCanonico - Token após expansão de abreviações
   * @param {string} [dados.tipo] - TokenType
   * @param {number} [dados.posicao] - Índice no produto canônico
   * @param {string} [dados.normalizado] - Forma normalizada (ex.: LAMPADA)
   */
  constructor(dados = {}) {
    this.textoOriginal = dados.textoOriginal ?? '';
    this.textoCanonico = dados.textoCanonico ?? '';
    this.tipo = dados.tipo ?? TokenType.DESCONHECIDO;
    this.posicao = dados.posicao ?? 0;
    this.normalizado = dados.normalizado ?? '';
  }

  /**
   * @param {Object} dados
   * @returns {CanonicalToken}
   */
  static create(dados = {}) {
    return new CanonicalToken(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      textoOriginal: this.textoOriginal,
      textoCanonico: this.textoCanonico,
      tipo: this.tipo,
      posicao: this.posicao,
      normalizado: this.normalizado
    };
  }
}

module.exports = CanonicalToken;
