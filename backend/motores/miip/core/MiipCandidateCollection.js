/**
 * MiipCandidateCollection — Coleção estruturada de candidatos do Pipeline.
 *
 * Sprint 2 Pipeline: armazenamento e operações estruturais — sem regras de score.
 *
 * @class MiipCandidateCollection
 */

const MiipCandidate = require('./MiipCandidate');

class MiipCandidateCollection {
  constructor() {
    /** @private @type {MiipCandidate[]} */
    this._itens = [];
  }

  /**
   * @param {MiipCandidate|Object} candidato
   * @returns {MiipCandidate}
   */
  adicionar(candidato) {
    const normalizado = candidato instanceof MiipCandidate
      ? candidato
      : MiipCandidate.create(candidato);

    this._itens.push(normalizado);
    return normalizado;
  }

  /**
   * Adiciona múltiplos candidatos.
   *
   * @param {Array<MiipCandidate|Object>} candidatos
   * @returns {number}
   */
  adicionarVarios(candidatos = []) {
    if (!Array.isArray(candidatos)) return 0;

    candidatos.forEach((candidato) => this.adicionar(candidato));
    return candidatos.length;
  }

  /**
   * Mescla candidatos do mesmo produtoId (sprint futura: agregação de evidências).
   *
   * @returns {MiipCandidateCollection}
   */
  mesclarIguais() {
    const porProduto = new Map();

    this._itens.forEach((candidato) => {
      const produtoId = Number(candidato.produtoId);
      if (!produtoId) return;

      if (!porProduto.has(produtoId)) {
        porProduto.set(produtoId, candidato);
        return;
      }

      const existente = porProduto.get(produtoId);
      const motores = new Set([
        ...existente.motoresQueVotaram,
        ...candidato.motoresQueVotaram
      ]);

      porProduto.set(produtoId, MiipCandidate.create({
        ...existente.toJSON(),
        scoreTotal: Math.max(existente.scoreTotal, candidato.scoreTotal),
        motoresQueVotaram: [...motores],
        evidencias: [...existente.evidencias, ...candidato.evidencias]
      }));
    });

    const colecao = new MiipCandidateCollection();
    porProduto.forEach((candidato) => colecao.adicionar(candidato));
    return colecao;
  }

  /**
   * Remove duplicatas por produtoId mantendo maior score.
   *
   * @returns {MiipCandidateCollection}
   */
  eliminarDuplicados() {
    return this.mesclarIguais();
  }

  /**
   * Ordena por scoreTotal decrescente.
   *
   * @returns {MiipCandidate[]}
   */
  ordenar() {
    return [...this._itens].sort((a, b) => b.scoreTotal - a.scoreTotal);
  }

  /**
   * Aplica ranking (1 = melhor) nos candidatos ordenados.
   *
   * @returns {MiipCandidate[]}
   */
  ranking() {
    return this.ordenar().map((candidato, indice) => MiipCandidate.create({
      ...candidato.toJSON(),
      ranking: indice + 1
    }));
  }

  /**
   * @returns {MiipCandidate|null}
   */
  melhor() {
    const ranqueados = this.ranking();
    return ranqueados[0] ?? null;
  }

  /**
   * @returns {number}
   */
  total() {
    return this._itens.length;
  }

  /**
   * @returns {MiipCandidate[]}
   */
  todos() {
    return [...this._itens];
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      total: this.total(),
      candidatos: this.ranking().map((c) => c.toJSON())
    };
  }
}

module.exports = MiipCandidateCollection;
