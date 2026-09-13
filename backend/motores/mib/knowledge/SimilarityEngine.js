'use strict';

const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');
const { similaridade, levenshtein } = require('../core/levenshtein');

/**
 * SimilarityEngine — score composto entre produtos.
 */
class SimilarityEngine {
  /**
   * @param {object} a
   * @param {object} b
   * @returns {{ score: number, detalhes: object }}
   */
  comparar(a, b) {
    if (!a || !b) return { score: 0, detalhes: {} };
    if (Number(a.id) === Number(b.id)) return { score: 100, detalhes: { mesmo: true } };

    const nomeA = normalizarNomeBusca(a.nome || a.nome_busca);
    const nomeB = normalizarNomeBusca(b.nome || b.nome_busca);
    const nomeSim = similaridade(nomeA, nomeB);

    const catEq = a.categoria_id != null && a.categoria_id === b.categoria_id ? 1 : 0;
    const marcaEq = a.marca_id != null && a.marca_id === b.marca_id ? 1 : 0;

    const precoA = Number(a.preco_venda ?? a.preco) || 0;
    const precoB = Number(b.preco_venda ?? b.preco) || 0;
    let precoSim = 0;
    if (precoA > 0 && precoB > 0) {
      const ratio = Math.min(precoA, precoB) / Math.max(precoA, precoB);
      precoSim = ratio;
    }

    const gtinA = String(a.codigo_barras || a.gtin || '').replace(/\D/g, '');
    const gtinB = String(b.codigo_barras || b.gtin || '').replace(/\D/g, '');
    const gtinEq = gtinA && gtinB && gtinA === gtinB ? 1 : 0;

    const ncmA = String(a.ncm || '').replace(/\D/g, '');
    const ncmB = String(b.ncm || '').replace(/\D/g, '');
    let ncmSim = 0;
    if (ncmA && ncmB) {
      if (ncmA === ncmB) ncmSim = 1;
      else if (ncmA.slice(0, 4) === ncmB.slice(0, 4)) ncmSim = 0.6;
      else if (ncmA.slice(0, 2) === ncmB.slice(0, 2)) ncmSim = 0.3;
    }

    const fornEq = a.fornecedor_id != null && a.fornecedor_id === b.fornecedor_id ? 1 : 0;

    const descA = normalizarNomeBusca(a.descricao || '');
    const descB = normalizarNomeBusca(b.descricao || '');
    const descSim = descA && descB ? similaridade(descA.slice(0, 80), descB.slice(0, 80)) : 0;

    // pesos
    const score =
      nomeSim * 35 +
      catEq * 15 +
      marcaEq * 15 +
      precoSim * 10 +
      gtinEq * 20 +
      ncmSim * 10 +
      fornEq * 5 +
      descSim * 5;

    return {
      score: Number(Math.min(100, score).toFixed(2)),
      detalhes: {
        nome: Number((nomeSim * 100).toFixed(1)),
        categoria: catEq * 100,
        marca: marcaEq * 100,
        preco: Number((precoSim * 100).toFixed(1)),
        gtin: gtinEq * 100,
        ncm: Number((ncmSim * 100).toFixed(1)),
        fornecedor: fornEq * 100,
        descricao: Number((descSim * 100).toFixed(1)),
        distNome: levenshtein(nomeA.slice(0, 40), nomeB.slice(0, 40))
      }
    };
  }

  /**
   * Top N similares a um produto no catálogo.
   * @param {object} produto
   * @param {object[]} catalogo
   * @param {{ limite?: number, minScore?: number }} [opcoes]
   */
  similares(produto, catalogo, opcoes = {}) {
    const limite = Math.min(Math.max(Number(opcoes.limite) || 10, 1), 50);
    const minScore = Number(opcoes.minScore) || 25;
    const out = [];
    for (const p of catalogo || []) {
      if (!p || Number(p.id) === Number(produto.id)) continue;
      const r = this.comparar(produto, p);
      if (r.score >= minScore) {
        out.push({
          id: p.id,
          nome: p.nome,
          codigo: p.codigo,
          codigo_barras: p.codigo_barras,
          preco_venda: p.preco_venda ?? p.preco,
          categoria_id: p.categoria_id,
          marca_id: p.marca_id,
          score: r.score,
          detalhes: r.detalhes
        });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limite);
  }
}

module.exports = SimilarityEngine;
