/**
 * SemanticAttribute — Atributo semântico individual de um produto.
 *
 * Sprint 7.2 — contrato de domínio. Sem extração nem lógica de negócio.
 *
 * @class SemanticAttribute
 */

const SemanticAttributeType = require('./SemanticAttributeType');
const SemanticMetadata = require('./SemanticMetadata');

class SemanticAttribute {
  /**
   * @param {Object} [dados]
   * @param {string|null} [dados.tipo] - SemanticAttributeType
   * @param {string|number|null} [dados.valor]
   * @param {number|null} [dados.confianca]
   * @param {string|null} [dados.origem]
   * @param {string|null} [dados.normalizado]
   * @param {SemanticMetadata|Object|null} [dados.metadata]
   */
  constructor(dados = {}) {
    this.tipo = dados.tipo ?? null;
    this.valor = dados.valor ?? null;
    this.confianca = dados.confianca ?? null;
    this.origem = dados.origem ?? null;
    this.normalizado = dados.normalizado ?? null;
    this.metadata = dados.metadata instanceof SemanticMetadata
      ? dados.metadata
      : (dados.metadata?.campo
        ? { ...dados.metadata }
        : (dados.metadata ? SemanticMetadata.create(dados.metadata) : null));
  }

  /**
   * @param {Object} [dados]
   * @returns {SemanticAttribute}
   */
  static create(dados = {}) {
    return new SemanticAttribute(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      tipo: this.tipo,
      valor: this.valor,
      confianca: this.confianca,
      origem: this.origem,
      normalizado: this.normalizado,
      metadata: this.metadata
        ? (typeof this.metadata.toJSON === 'function' ? this.metadata.toJSON() : this.metadata)
        : null
    };
  }
}

SemanticAttribute.TIPOS_VALIDOS = SemanticAttributeType.TODOS;

module.exports = SemanticAttribute;
