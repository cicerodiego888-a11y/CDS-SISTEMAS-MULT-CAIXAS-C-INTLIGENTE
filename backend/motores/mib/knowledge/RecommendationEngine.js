'use strict';

const { REL } = require('./relations');

/**
 * RecommendationEngine — "quem compra X também compra Y".
 */
class RecommendationEngine {
  /**
   * @param {import('./KnowledgeGraph')} graph
   * @param {import('./SimilarityEngine')} similarity
   */
  constructor(graph, similarity) {
    this.graph = graph;
    this.similarity = similarity;
  }

  /**
   * @param {number|string} produtoId
   * @param {{ limite?: number, catalogo?: object[] }} [opcoes]
   */
  recomendar(produtoId, opcoes = {}) {
    const limite = Math.min(Math.max(Number(opcoes.limite) || 8, 1), 30);
    const id = Number(produtoId);
    if (!id) return { produto_id: id, recomendacoes: [] };

    const nodeId = `produto:${id}`;
    const scores = new Map();

    // 1) vendido junto / comprado junto
    for (const edge of this.graph.edgesFrom(nodeId, [REL.VENDIDO_JUNTO, REL.COMPRADO_JUNTO])) {
      const pid = this._produtoId(edge.to_id);
      if (!pid || pid === id) continue;
      scores.set(pid, (scores.get(pid) || 0) + (Number(edge.peso) || 1) * 10);
    }
    for (const edge of this.graph.edgesTo(nodeId, [REL.VENDIDO_JUNTO, REL.COMPRADO_JUNTO])) {
      const pid = this._produtoId(edge.from_id);
      if (!pid || pid === id) continue;
      scores.set(pid, (scores.get(pid) || 0) + (Number(edge.peso) || 1) * 10);
    }

    // 2) similar / mesma categoria / mesma marca
    for (const edge of this.graph.edgesFrom(nodeId, [REL.SIMILAR, REL.MESMA_CATEGORIA, REL.MESMA_MARCA, REL.SUBSTITUI, REL.COMPATIVEL])) {
      const pid = this._produtoId(edge.to_id);
      if (!pid || pid === id) continue;
      const boost = edge.relacao === REL.SUBSTITUI ? 8 : edge.relacao === REL.SIMILAR ? 6 : 4;
      scores.set(pid, (scores.get(pid) || 0) + boost * (Number(edge.peso) || 1));
    }

    // 3) fallback similarity no catálogo
    if (scores.size < limite && opcoes.catalogo?.length) {
      const base = opcoes.catalogo.find((p) => Number(p.id) === id);
      if (base) {
        const sims = this.similarity.similares(base, opcoes.catalogo, { limite: limite * 2, minScore: 30 });
        for (const s of sims) {
          scores.set(Number(s.id), (scores.get(Number(s.id)) || 0) + s.score / 10);
        }
      }
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limite)
      .map(([pid, score]) => {
        const node = this.graph.getNode(`produto:${pid}`);
        const cat = opcoes.catalogo?.find((p) => Number(p.id) === pid);
        return {
          produto_id: pid,
          nome: cat?.nome || node?.label || `Produto ${pid}`,
          codigo: cat?.codigo || null,
          preco_venda: cat?.preco_venda ?? cat?.preco ?? null,
          score: Number(score.toFixed(2)),
          motivo: this._motivo(nodeId, `produto:${pid}`)
        };
      });

    return { produto_id: id, recomendacoes: ranked };
  }

  _motivo(fromId, toId) {
    const edges = [
      ...this.graph.edgesFrom(fromId),
      ...this.graph.edgesTo(fromId)
    ].filter((e) => e.from_id === toId || e.to_id === toId || e.from_id === fromId);
    const rels = new Set(edges.filter((e) => e.from_id === toId || e.to_id === toId).map((e) => e.relacao));
    if (rels.has(REL.VENDIDO_JUNTO) || rels.has(REL.COMPRADO_JUNTO)) return 'frequentemente_comprado_junto';
    if (rels.has(REL.SUBSTITUI)) return 'substituto';
    if (rels.has(REL.SIMILAR)) return 'similar';
    if (rels.has(REL.MESMA_MARCA)) return 'mesma_marca';
    if (rels.has(REL.MESMA_CATEGORIA)) return 'mesma_categoria';
    return 'recomendado';
  }

  _produtoId(nodeId) {
    const m = String(nodeId || '').match(/^produto:(\d+)$/);
    return m ? Number(m[1]) : null;
  }
}

module.exports = RecommendationEngine;
