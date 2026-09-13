/**
 * NsuControle — Estado da sincronização DF-e por CNPJ/ambiente.
 *
 * Sprint 1: modelo de domínio para controle de NSU (uso em sprint de sincronização).
 *
 * @class NsuControle
 */

class NsuControle {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id ?? null;
    this.cnpj = dados.cnpj ?? '';
    this.ambiente = dados.ambiente ?? 2;
    this.ultNsu = dados.ultNsu ?? dados.ult_nsu ?? '000000000000000';
    this.updatedAt = dados.updatedAt ?? dados.updated_at ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {NsuControle}
   */
  static create(plain) {
    return new NsuControle(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      cnpj: this.cnpj,
      ambiente: this.ambiente,
      ultNsu: this.ultNsu,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = NsuControle;
