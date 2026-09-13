/**
 * MiipCandidate — Candidato consolidado para o Pipeline MIIP.
 *
 * Representa um produto candidato após agregação dos motores,
 * com score total, confiança, ranking, snapshot e evidências.
 *
 * Sprint 3.1: inclui `ProdutoSnapshot` para evitar reconsultas ao banco.
 *
 * @class MiipCandidate
 */

const MiipEvidence = require('./MiipEvidence');
const ProdutoSnapshot = require('./ProdutoSnapshot');

class MiipCandidate {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.produtoId] - ID do produto no ERP
   * @param {ProdutoSnapshot|Object|null} [dados.snapshot] - Snapshot oficial do produto
   * @param {Object|null} [dados.produto] - Resumo legado do produto
   * @param {number} [dados.scoreTotal] - Score consolidado (0–100)
   * @param {string|null} [dados.confianca] - Nível MiipConfidence
   * @param {number} [dados.ranking] - Posição no ranking (1 = melhor)
   * @param {MiipEvidence[]|Object[]} [dados.evidencias] - Evidências que sustentam o candidato
   * @param {string[]} [dados.motoresQueVotaram] - Códigos dos motores que apontaram este candidato
   * @param {Object} [dados.atributosExtraidos] - Atributos derivados (NCM, unidade, etc.)
   */
  constructor(dados = {}) {
    this.produtoId = Number(dados.produtoId ?? dados.produto_id ?? 0);
    this.snapshot = dados.snapshot instanceof ProdutoSnapshot
      ? dados.snapshot
      : ProdutoSnapshot.fromJSON(dados.snapshot);
    this.produto = dados.produto ?? (this.snapshot ? this.snapshot.toResumo() : null);
    this.scoreTotal = Number(dados.scoreTotal ?? dados.score_total ?? 0);
    this.confianca = dados.confianca ?? null;
    this.ranking = Number(dados.ranking ?? 0);
    this.evidencias = Array.isArray(dados.evidencias)
      ? dados.evidencias.map((ev) => (ev instanceof MiipEvidence ? ev : MiipEvidence.fromJSON(ev)))
      : [];
    this.motoresQueVotaram = Array.isArray(dados.motoresQueVotaram)
      ? [...dados.motoresQueVotaram]
      : Array.isArray(dados.motores_que_votaram)
        ? [...dados.motores_que_votaram]
        : [];
    this.atributosExtraidos = dados.atributosExtraidos ?? dados.atributos_extraidos ?? {};
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipCandidate}
   */
  static create(plain) {
    return new MiipCandidate(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      produtoId: this.produtoId,
      snapshot: this.snapshot ? this.snapshot.toJSON() : null,
      produto: this.produto,
      scoreTotal: this.scoreTotal,
      confianca: this.confianca,
      ranking: this.ranking,
      evidencias: this.evidencias.map((ev) => ev.toJSON()),
      motoresQueVotaram: this.motoresQueVotaram,
      atributosExtraidos: this.atributosExtraidos
    };
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipCandidate}
   */
  static fromJSON(plain) {
    return new MiipCandidate(plain || {});
  }
}

module.exports = MiipCandidate;
