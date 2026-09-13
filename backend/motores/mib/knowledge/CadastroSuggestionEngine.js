'use strict';

const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');
const { tokenizar } = require('../core/tokenizer');

/**
 * Sugestões ao cadastrar produto novo.
 */
class CadastroSuggestionEngine {
  /**
   * @param {import('./SimilarityEngine')} similarity
   * @param {import('./KnowledgeGraph')} graph
   */
  constructor(similarity, graph) {
    this.similarity = similarity;
    this.graph = graph;
  }

  /**
   * @param {{ nome?: string, codigo_barras?: string, ncm?: string, preco_venda?: number }} rascunho
   * @param {object[]} catalogo
   * @param {{ marcas?: object[], categorias?: object[] }} [refs]
   */
  sugerir(rascunho = {}, catalogo = [], refs = {}) {
    const nome = String(rascunho.nome || '').trim();
    const fake = {
      id: -1,
      nome,
      nome_busca: normalizarNomeBusca(nome),
      codigo_barras: rascunho.codigo_barras,
      ncm: rascunho.ncm,
      preco_venda: rascunho.preco_venda
    };

    const similares = nome
      ? this.similarity.similares(fake, catalogo, { limite: 8, minScore: 18 })
      : [];

    const votosCat = new Map();
    const votosMarca = new Map();
    const ncms = [];
    const cests = [];
    const precos = [];
    const fornecedores = new Map();

    for (const s of similares) {
      const full = catalogo.find((p) => Number(p.id) === Number(s.id));
      if (!full) continue;
      if (full.categoria_id) votosCat.set(full.categoria_id, (votosCat.get(full.categoria_id) || 0) + s.score);
      if (full.marca_id) votosMarca.set(full.marca_id, (votosMarca.get(full.marca_id) || 0) + s.score);
      if (full.ncm) ncms.push(String(full.ncm));
      if (full.cest) cests.push(String(full.cest));
      if (full.preco_venda != null || full.preco != null) {
        precos.push(Number(full.preco_venda ?? full.preco) || 0);
      }
      if (full.fornecedor_id) {
        fornecedores.set(full.fornecedor_id, (fornecedores.get(full.fornecedor_id) || 0) + 1);
      }
    }

    // token → categoria por grafo
    if (!votosCat.size && nome) {
      const tok = tokenizar(nome).tokensNorm[0];
      if (tok) {
        for (const n of this.graph.nodesByTipo('categoria')) {
          if (normalizarNomeBusca(n.label).includes(tok)) {
            votosCat.set(n.ref_id, 50);
          }
        }
      }
    }

    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const moda = (arr) => {
      if (!arr.length) return null;
      const m = new Map();
      for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };

    const catId = top(votosCat);
    const marcaId = top(votosMarca);
    const catRef = (refs.categorias || []).find((c) => Number(c.id) === Number(catId));
    const marcaRef = (refs.marcas || []).find((m) => Number(m.id) === Number(marcaId));

    const precoMedio = precos.length
      ? Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2))
      : null;

    return {
      categoria: catId ? { id: catId, nome: catRef?.nome || null } : null,
      marca: marcaId ? { id: marcaId, nome: marcaRef?.nome || null } : null,
      ncm: moda(ncms) || rascunho.ncm || null,
      cest: moda(cests) || null,
      fornecedor_id: top(fornecedores),
      preco_medio: precoMedio,
      produtos_semelhantes: similares,
      confianca: similares.length
        ? Number(Math.min(95, similares[0].score).toFixed(1))
        : 0
    };
  }
}

module.exports = CadastroSuggestionEngine;
