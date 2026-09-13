'use strict';

const { NODE_TYPES, REL } = require('./relations');
const { garantirSchemaKnowledge } = require('./KnowledgeSchema');

/**
 * Grafo em memória + persistência SQLite.
 * Rebuild é offline em relação ao SearchService (zero impacto no hot-path).
 */
class KnowledgeGraph {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    /** @type {Map<string, { id: string, tipo: string, ref_id: number|null, label: string, meta: object }>} */
    this.nodes = new Map();
    /** @type {Map<string, Array<{ from_id: string, to_id: string, relacao: string, peso: number, origem: string }>>} */
    this.out = new Map();
    /** @type {Map<string, Array<{ from_id: string, to_id: string, relacao: string, peso: number, origem: string }>>} */
    this.inn = new Map();
    this.clusters = [];
    this.stats = { nos: 0, arestas: 0, clusters: 0, lastRebuild: null };
  }

  nodeKey(tipo, refId) {
    return `${tipo}:${refId}`;
  }

  addNode(tipo, refId, label, meta = {}) {
    const id = this.nodeKey(tipo, refId);
    this.nodes.set(id, {
      id,
      tipo,
      ref_id: refId != null ? Number(refId) : null,
      label: String(label || id),
      meta
    });
    return id;
  }

  addEdge(fromId, toId, relacao, peso = 1, origem = 'auto') {
    if (!fromId || !toId || fromId === toId) return;
    const edge = {
      from_id: fromId,
      to_id: toId,
      relacao,
      peso: Number(peso) || 1,
      origem
    };
    if (!this.out.has(fromId)) this.out.set(fromId, []);
    if (!this.inn.has(toId)) this.inn.set(toId, []);
    // upsert memória
    const outs = this.out.get(fromId);
    const idx = outs.findIndex((e) => e.to_id === toId && e.relacao === relacao);
    if (idx >= 0) outs[idx] = edge;
    else outs.push(edge);

    const inns = this.inn.get(toId);
    const idx2 = inns.findIndex((e) => e.from_id === fromId && e.relacao === relacao);
    if (idx2 >= 0) inns[idx2] = edge;
    else inns.push(edge);
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  nodesByTipo(tipo) {
    return [...this.nodes.values()].filter((n) => n.tipo === tipo);
  }

  edgesFrom(id, relacoes = null) {
    const list = this.out.get(id) || [];
    if (!relacoes) return list;
    const set = new Set(relacoes);
    return list.filter((e) => set.has(e.relacao));
  }

  edgesTo(id, relacoes = null) {
    const list = this.inn.get(id) || [];
    if (!relacoes) return list;
    const set = new Set(relacoes);
    return list.filter((e) => set.has(e.relacao));
  }

  topRelacoes(limite = 20) {
    const all = [];
    for (const list of this.out.values()) {
      for (const e of list) all.push(e);
    }
    all.sort((a, b) => (b.peso || 0) - (a.peso || 0));
    return all.slice(0, limite).map((e) => ({
      ...e,
      from_label: this.nodes.get(e.from_id)?.label,
      to_label: this.nodes.get(e.to_id)?.label
    }));
  }

  snapshot() {
    return {
      nos: this.nodes.size,
      arestas: [...this.out.values()].reduce((n, a) => n + a.length, 0),
      clusters: this.clusters.length,
      tipos: this._contarTipos(),
      lastRebuild: this.stats.lastRebuild
    };
  }

  _contarTipos() {
    const m = {};
    for (const n of this.nodes.values()) {
      m[n.tipo] = (m[n.tipo] || 0) + 1;
    }
    return m;
  }

  clear() {
    this.nodes.clear();
    this.out.clear();
    this.inn.clear();
    this.clusters = [];
  }

  async garantirSchema() {
    await garantirSchemaKnowledge(this.db);
  }

  /**
   * Persiste grafo atual (replace).
   */
  async persistir() {
    await this.garantirSchema();
    await this._run(`DELETE FROM mib_kg_edges`);
    await this._run(`DELETE FROM mib_kg_nodes`);
    await this._run(`DELETE FROM mib_kg_clusters`);

    for (const n of this.nodes.values()) {
      await this._run(
        `INSERT INTO mib_kg_nodes (id, tipo, ref_id, label, meta) VALUES (?, ?, ?, ?, ?)`,
        [n.id, n.tipo, n.ref_id, n.label, JSON.stringify(n.meta || {})]
      );
    }
    for (const list of this.out.values()) {
      for (const e of list) {
        await this._run(
          `INSERT OR REPLACE INTO mib_kg_edges (from_id, to_id, relacao, peso, origem)
           VALUES (?, ?, ?, ?, ?)`,
          [e.from_id, e.to_id, e.relacao, e.peso, e.origem]
        );
      }
    }
    for (const c of this.clusters) {
      await this._run(
        `INSERT INTO mib_kg_clusters (id, nome, tamanho, centroide_id, meta)
         VALUES (?, ?, ?, ?, ?)`,
        [c.id, c.nome, c.tamanho, c.centroide_id, JSON.stringify({ produto_ids: c.produto_ids })]
      );
    }
  }

  async carregar() {
    await this.garantirSchema();
    this.clear();
    const nodes = await this._all(`SELECT * FROM mib_kg_nodes`);
    for (const n of nodes) {
      let meta = {};
      try { meta = JSON.parse(n.meta || '{}'); } catch (_) { /* ignore */ }
      this.nodes.set(n.id, {
        id: n.id,
        tipo: n.tipo,
        ref_id: n.ref_id,
        label: n.label,
        meta
      });
    }
    const edges = await this._all(`SELECT * FROM mib_kg_edges`);
    for (const e of edges) {
      this.addEdge(e.from_id, e.to_id, e.relacao, e.peso, e.origem);
    }
    const clusters = await this._all(`SELECT * FROM mib_kg_clusters`);
    this.clusters = clusters.map((c) => {
      let meta = {};
      try { meta = JSON.parse(c.meta || '{}'); } catch (_) { /* ignore */ }
      return {
        id: c.id,
        nome: c.nome,
        tamanho: c.tamanho,
        centroide_id: c.centroide_id,
        produto_ids: meta.produto_ids || []
      };
    });
    this.stats = { ...this.snapshot(), lastRebuild: this.stats.lastRebuild };
    return this.snapshot();
  }

  _run(sql, params = []) {
    return new Promise((resolve) => {
      this.db.run(sql, params, () => resolve());
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve) => {
      this.db.all(sql, params, (err, rows) => resolve(err ? [] : (rows || [])));
    });
  }
}

KnowledgeGraph.NODE_TYPES = NODE_TYPES;
KnowledgeGraph.REL = REL;

module.exports = KnowledgeGraph;
