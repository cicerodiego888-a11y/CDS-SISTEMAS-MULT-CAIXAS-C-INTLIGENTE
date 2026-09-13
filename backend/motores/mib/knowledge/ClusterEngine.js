'use strict';

const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');
const { tokenizar } = require('../core/tokenizer');

/**
 * Clusterização automática por token dominante / categoria / marca.
 */
class ClusterEngine {
  /**
   * @param {object[]} produtos
   * @returns {{ id: string, nome: string, tamanho: number, produto_ids: number[], centroide_id: number|null }[]}
   */
  clusterizar(produtos = []) {
    /** @type {Map<string, { ids: number[], nome: string, scores: Map<number, number> }>} */
    const buckets = new Map();

    for (const p of produtos) {
      if (!p?.id) continue;
      const chave = this._chaveCluster(p);
      if (!buckets.has(chave)) {
        buckets.set(chave, { ids: [], nome: this._nomeCluster(chave, p), scores: new Map() });
      }
      const b = buckets.get(chave);
      b.ids.push(Number(p.id));
      b.scores.set(Number(p.id), Number(p.preco_venda ?? p.preco) || 0);
    }

    const clusters = [];
    let i = 0;
    for (const [chave, b] of buckets.entries()) {
      if (b.ids.length < 1) continue;
      i += 1;
      // centroide = preço mediano
      const sorted = [...b.ids].sort((a, c) => (b.scores.get(a) || 0) - (b.scores.get(c) || 0));
      const mid = sorted[Math.floor(sorted.length / 2)];
      clusters.push({
        id: `cluster:${chave}`,
        nome: b.nome,
        tamanho: b.ids.length,
        produto_ids: b.ids,
        centroide_id: mid || null,
        chave
      });
    }

    clusters.sort((a, b) => b.tamanho - a.tamanho);
    return clusters;
  }

  _chaveCluster(p) {
    if (p.categoria_id) return `cat:${p.categoria_id}`;
    const tok = tokenizar(p.nome || '');
    const principal = tok.tokensNorm[0] || normalizarNomeBusca(p.nome).slice(0, 8) || 'outros';
    // agrupa por primeiro token significativo
    return `tok:${principal}`;
  }

  _nomeCluster(chave, sample) {
    if (chave.startsWith('cat:')) {
      return sample.categoria_nome || `Categoria ${chave.slice(4)}`;
    }
    if (chave.startsWith('tok:')) {
      const t = chave.slice(4);
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return chave;
  }
}

module.exports = ClusterEngine;
