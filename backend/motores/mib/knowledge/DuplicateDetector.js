'use strict';

const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');
const { similaridade } = require('../core/levenshtein');

/**
 * Detecção de duplicados — produtos, GTIN, marcas, categorias.
 */
class DuplicateDetector {
  /**
   * @param {{
   *   produtos?: object[],
   *   marcas?: object[],
   *   categorias?: object[]
   * }} dados
   * @param {{ minNome?: number }} [opcoes]
   */
  detectar(dados = {}, opcoes = {}) {
    const minNome = Number(opcoes.minNome) || 0.88;
    return {
      produtos: this._duplicadosProdutos(dados.produtos || [], minNome),
      gtin: this._gtinRepetido(dados.produtos || []),
      marcas: this._duplicadosNome(dados.marcas || [], 'marca'),
      categorias: this._duplicadosNome(dados.categorias || [], 'categoria')
    };
  }

  _duplicadosProdutos(produtos, minNome) {
    const out = [];
    const byGtin = new Map();
    for (const p of produtos) {
      const g = String(p.codigo_barras || '').replace(/\D/g, '');
      if (g.length >= 8) {
        if (!byGtin.has(g)) byGtin.set(g, []);
        byGtin.get(g).push(p);
      }
    }
    for (const [gtin, lista] of byGtin) {
      if (lista.length > 1) {
        out.push({
          tipo: 'gtin',
          chave: gtin,
          itens: lista.map((p) => ({ id: p.id, nome: p.nome, codigo: p.codigo }))
        });
      }
    }

    // similaridade de nome (amostra limitada)
    const sample = produtos.slice(0, 800);
    const vistos = new Set();
    for (let i = 0; i < sample.length; i += 1) {
      const a = sample[i];
      const na = normalizarNomeBusca(a.nome);
      if (!na || na.length < 4) continue;
      for (let j = i + 1; j < sample.length; j += 1) {
        const b = sample[j];
        const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
        if (vistos.has(key)) continue;
        const nb = normalizarNomeBusca(b.nome);
        if (!nb) continue;
        const sim = similaridade(na, nb);
        if (sim >= minNome && Number(a.id) !== Number(b.id)) {
          // evita duplicar pares já cobertos por GTIN
          const ga = String(a.codigo_barras || '').replace(/\D/g, '');
          const gb = String(b.codigo_barras || '').replace(/\D/g, '');
          if (ga && ga === gb) continue;
          vistos.add(key);
          out.push({
            tipo: 'nome',
            chave: na.slice(0, 40),
            score: Number((sim * 100).toFixed(1)),
            itens: [
              { id: a.id, nome: a.nome, codigo: a.codigo },
              { id: b.id, nome: b.nome, codigo: b.codigo }
            ]
          });
        }
      }
      if (out.length >= 80) break;
    }
    return out;
  }

  _gtinRepetido(produtos) {
    const map = new Map();
    for (const p of produtos) {
      const g = String(p.codigo_barras || '').replace(/\D/g, '');
      if (g.length < 8) continue;
      if (!map.has(g)) map.set(g, []);
      map.get(g).push({ id: p.id, nome: p.nome });
    }
    return [...map.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([gtin, itens]) => ({ gtin, itens }));
  }

  _duplicadosNome(lista, tipo) {
    const map = new Map();
    for (const item of lista) {
      const n = normalizarNomeBusca(item.nome);
      if (!n) continue;
      if (!map.has(n)) map.set(n, []);
      map.get(n).push(item);
    }
    const out = [];
    for (const [nome, itens] of map) {
      if (itens.length > 1) {
        out.push({ tipo, nome, itens: itens.map((i) => ({ id: i.id, nome: i.nome })) });
      }
    }
    // near-duplicates
    const keys = [...map.keys()].slice(0, 300);
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        if (similaridade(keys[i], keys[j]) >= 0.92) {
          out.push({
            tipo: `${tipo}_similar`,
            nome: keys[i],
            itens: [
              ...(map.get(keys[i]) || []).map((x) => ({ id: x.id, nome: x.nome })),
              ...(map.get(keys[j]) || []).map((x) => ({ id: x.id, nome: x.nome }))
            ]
          });
        }
      }
    }
    return out.slice(0, 40);
  }
}

module.exports = DuplicateDetector;
