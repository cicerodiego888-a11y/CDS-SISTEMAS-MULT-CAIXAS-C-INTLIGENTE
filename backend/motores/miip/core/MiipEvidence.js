/**
 * MiipEvidence — Evidência produzida por um motor de identificação.
 *
 * Representa um fato observado durante a execução de um engine
 * (ex.: GTIN encontrado, associação fornecedor confirmada).
 * Utilizada para montar relatórios de decisão e auditoria.
 *
 * Sprint 1.1: objeto de valor estrutural — sem regras de negócio.
 *
 * @class MiipEvidence
 *
 * @example
 * MiipEvidence.create({
 *   motor: 'motor_gtin',
 *   tipo: 'gtin_exato',
 *   descricao: 'GTIN encontrado na base de produtos',
 *   peso: 100,
 *   valor: '7891234567890',
 *   score: 100
 * });
 */

class MiipEvidence {
  /**
   * @param {Object} [dados]
   * @param {string} [dados.motor] - Código do motor que produziu a evidência
   * @param {string} [dados.tipo] - Tipo da evidência (ex.: gtin_exato, associacao_fornecedor)
   * @param {string} [dados.descricao] - Descrição legível para relatório
   * @param {number} [dados.peso] - Peso da evidência na agregação (0–100)
   * @param {string|number|null} [dados.valor] - Valor observado (GTIN, cProd, etc.)
   * @param {number} [dados.score] - Score parcial atribuído por esta evidência
   * @param {string|null} [dados.timestamp] - ISO 8601 do momento da evidência
   */
  constructor(dados = {}) {
    this.motor = dados.motor ?? '';
    this.tipo = dados.tipo ?? '';
    this.descricao = dados.descricao ?? '';
    this.peso = Number(dados.peso ?? 0);
    this.valor = dados.valor ?? null;
    this.score = Number(dados.score ?? 0);
    this.timestamp = dados.timestamp ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipEvidence}
   */
  static create(plain) {
    return new MiipEvidence(plain || {});
  }

  /**
   * Cria evidência com timestamp atual.
   *
   * @param {Object} [dados]
   * @returns {MiipEvidence}
   */
  static agora(dados = {}) {
    return new MiipEvidence({
      ...dados,
      timestamp: dados.timestamp ?? new Date().toISOString()
    });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      motor: this.motor,
      tipo: this.tipo,
      descricao: this.descricao,
      peso: this.peso,
      valor: this.valor,
      score: this.score,
      timestamp: this.timestamp
    };
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipEvidence}
   */
  static fromJSON(plain) {
    return new MiipEvidence(plain || {});
  }
}

module.exports = MiipEvidence;
