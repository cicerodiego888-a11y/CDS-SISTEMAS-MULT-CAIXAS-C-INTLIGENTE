'use strict';

const KnowledgeGraph = require('./KnowledgeGraph');
const SimilarityEngine = require('./SimilarityEngine');
const RecommendationEngine = require('./RecommendationEngine');
const ClusterEngine = require('./ClusterEngine');
const DuplicateDetector = require('./DuplicateDetector');
const SalesLearning = require('./SalesLearning');
const CadastroSuggestionEngine = require('./CadastroSuggestionEngine');
const { NODE_TYPES, REL } = require('./relations');
const { aplicarContexto } = require('./SearchContext');

/** @type {KnowledgeService|null} */
let singleton = null;

/**
 * KnowledgeService — Motor de Conhecimento MIB-RC4.0.
 * Isolado do hot-path do SearchService.
 */
class KnowledgeService {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.graph = new KnowledgeGraph(db);
    this.similarity = new SimilarityEngine();
    this.clusters = new ClusterEngine();
    this.duplicates = new DuplicateDetector();
    this.sales = new SalesLearning(db);
    this.recommend = new RecommendationEngine(this.graph, this.similarity);
    this.cadastro = new CadastroSuggestionEngine(this.similarity, this.graph);
    this._catalogo = [];
    this._marcas = [];
    this._categorias = [];
    this._rebuilding = false;
    this._pronto = false;
  }

  static getInstance(db) {
    if (!singleton) singleton = new KnowledgeService(db);
    else if (db && singleton.db !== db) singleton = new KnowledgeService(db);
    return singleton;
  }

  static resetInstance() {
    singleton = null;
  }

  async iniciar() {
    await this.graph.garantirSchema();
    const snap = await this.graph.carregar();
    if (snap.nos === 0) {
      await this.rebuild({ leve: true });
    }
    this._pronto = true;
    return { ok: true, graph: this.graph.snapshot() };
  }

  async _ensure() {
    if (!this._pronto) await this.iniciar();
  }

  /**
   * Rebuild completo do grafo (assíncrono / fora do SearchService).
   */
  async rebuild(opcoes = {}) {
    if (this._rebuilding) return { ok: false, motivo: 'rebuild_em_andamento' };
    this._rebuilding = true;
    const inicio = process.hrtime.bigint();
    try {
      await this.graph.garantirSchema();
      const produtos = await this._loadProdutos();
      const marcas = await this._all(`SELECT id, nome FROM marcas`);
      const categorias = await this._all(`SELECT id, nome FROM categorias`);
      const fornecedores = await this._all(`SELECT id, nome FROM fornecedores LIMIT 500`);
      this._catalogo = produtos;
      this._marcas = marcas;
      this._categorias = categorias;

      this.graph.clear();

      for (const m of marcas) {
        this.graph.addNode(NODE_TYPES.MARCA, m.id, m.nome);
      }
      for (const c of categorias) {
        this.graph.addNode(NODE_TYPES.CATEGORIA, c.id, c.nome);
      }
      for (const f of fornecedores) {
        this.graph.addNode(NODE_TYPES.FORNECEDOR, f.id, f.nome);
      }

      for (const p of produtos) {
        const pid = this.graph.addNode(NODE_TYPES.PRODUTO, p.id, p.nome, {
          codigo: p.codigo,
          gtin: p.codigo_barras,
          ncm: p.ncm,
          preco: p.preco_venda
        });

        if (p.categoria_id) {
          const cid = this.graph.nodeKey(NODE_TYPES.CATEGORIA, p.categoria_id);
          if (this.graph.getNode(cid)) {
            this.graph.addEdge(pid, cid, REL.PERTENCE_A, 1, 'cadastro');
          }
        }
        if (p.marca_id) {
          const mid = this.graph.nodeKey(NODE_TYPES.MARCA, p.marca_id);
          if (this.graph.getNode(mid)) {
            this.graph.addEdge(pid, mid, REL.FABRICADO_POR, 1, 'cadastro');
          }
        }
        if (p.ncm) {
          const nid = this.graph.addNode(NODE_TYPES.NCM, p.ncm, String(p.ncm));
          this.graph.addEdge(pid, nid, REL.PERTENCE_A, 0.5, 'fiscal');
        }
        if (p.cfop) {
          const fid = this.graph.addNode(NODE_TYPES.CFOP, p.cfop, String(p.cfop));
          this.graph.addEdge(pid, fid, REL.COMPATIVEL, 0.3, 'fiscal');
        }
        if (p.cest) {
          const cestId = this.graph.addNode(NODE_TYPES.CEST, p.cest, String(p.cest));
          this.graph.addEdge(pid, cestId, REL.PERTENCE_A, 0.3, 'fiscal');
        }
      }

      // mesma categoria / marca
      this._ligarMesmoCampo(produtos, 'categoria_id', REL.MESMA_CATEGORIA);
      this._ligarMesmoCampo(produtos, 'marca_id', REL.MESMA_MARCA);

      // similaridade (amostra)
      if (!opcoes.leve) {
        this._ligarSimilares(produtos);
      } else {
        this._ligarSimilares(produtos.slice(0, 200));
      }

      // vendas
      const vendas = await this.sales.analisar({ dias: opcoes.dias || 90 });
      for (const par of vendas.vendidoJunto) {
        const a = this.graph.nodeKey(NODE_TYPES.PRODUTO, par.a);
        const b = this.graph.nodeKey(NODE_TYPES.PRODUTO, par.b);
        if (this.graph.getNode(a) && this.graph.getNode(b)) {
          this.graph.addEdge(a, b, REL.VENDIDO_JUNTO, par.peso, 'vendas');
          this.graph.addEdge(b, a, REL.COMPRADO_JUNTO, par.peso, 'vendas');
        }
      }

      // clusters
      const clusters = this.clusters.clusterizar(produtos);
      this.graph.clusters = clusters;
      for (const c of clusters) {
        this.graph.addNode(NODE_TYPES.CLUSTER, c.chave, c.nome, { tamanho: c.tamanho });
        const clusterNode = this.graph.nodeKey(NODE_TYPES.CLUSTER, c.chave);
        for (const pid of c.produto_ids.slice(0, 200)) {
          this.graph.addEdge(
            this.graph.nodeKey(NODE_TYPES.PRODUTO, pid),
            clusterNode,
            REL.NO_CLUSTER,
            1,
            'cluster'
          );
        }
      }

      await this.graph.persistir();
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      const snap = this.graph.snapshot();
      this.graph.stats = { ...snap, lastRebuild: new Date().toISOString() };
      await this._run(
        `INSERT INTO mib_kg_rebuild_log (nos, arestas, clusters, tempo_ms, ok) VALUES (?, ?, ?, ?, 1)`,
        [snap.nos, snap.arestas, snap.clusters, ms]
      );

      return {
        ok: true,
        ...snap,
        tempoMs: Number(ms.toFixed(2)),
        vendasPares: vendas.vendidoJunto.length
      };
    } finally {
      this._rebuilding = false;
    }
  }

  _ligarMesmoCampo(produtos, campo, relacao) {
    const grupos = new Map();
    for (const p of produtos) {
      const k = p[campo];
      if (k == null) continue;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    for (const lista of grupos.values()) {
      if (lista.length < 2 || lista.length > 80) continue;
      // liga em estrela no primeiro para limitar arestas
      const hub = lista[0];
      const hubId = this.graph.nodeKey(NODE_TYPES.PRODUTO, hub.id);
      for (let i = 1; i < Math.min(lista.length, 25); i += 1) {
        const other = this.graph.nodeKey(NODE_TYPES.PRODUTO, lista[i].id);
        this.graph.addEdge(hubId, other, relacao, 1, 'auto');
        this.graph.addEdge(other, hubId, relacao, 1, 'auto');
      }
    }
  }

  _ligarSimilares(produtos) {
    const limite = Math.min(produtos.length, 400);
    for (let i = 0; i < limite; i += 1) {
      const sims = this.similarity.similares(produtos[i], produtos, { limite: 3, minScore: 45 });
      const from = this.graph.nodeKey(NODE_TYPES.PRODUTO, produtos[i].id);
      for (const s of sims) {
        const to = this.graph.nodeKey(NODE_TYPES.PRODUTO, s.id);
        this.graph.addEdge(from, to, REL.SIMILAR, s.score / 100, 'similarity');
        if (s.score >= 70) {
          this.graph.addEdge(from, to, REL.SUBSTITUI, s.score / 100, 'similarity');
        }
        if (s.detalhes?.marca === 100 && s.detalhes?.categoria !== 100) {
          this.graph.addEdge(from, to, REL.CONCORRENTE, 0.5, 'similarity');
        }
      }
    }
  }

  async recommendations(produtoId, limite) {
    await this._ensure();
    if (!this._catalogo.length) this._catalogo = await this._loadProdutos();
    return this.recommend.recomendar(produtoId, {
      limite,
      catalogo: this._catalogo
    });
  }

  async similar(produtoId, limite) {
    await this._ensure();
    if (!this._catalogo.length) this._catalogo = await this._loadProdutos();
    const p = this._catalogo.find((x) => Number(x.id) === Number(produtoId));
    if (!p) return { produto_id: produtoId, similares: [] };
    return {
      produto_id: Number(produtoId),
      similares: this.similarity.similares(p, this._catalogo, { limite: limite || 10 })
    };
  }

  async detectDuplicates() {
    await this._ensure();
    if (!this._catalogo.length) this._catalogo = await this._loadProdutos();
    if (!this._marcas.length) this._marcas = await this._all(`SELECT id, nome FROM marcas`);
    if (!this._categorias.length) this._categorias = await this._all(`SELECT id, nome FROM categorias`);
    return this.duplicates.detectar({
      produtos: this._catalogo,
      marcas: this._marcas,
      categorias: this._categorias
    });
  }

  async graphView(limite = 100) {
    await this._ensure();
    const nodes = [...this.graph.nodes.values()].slice(0, limite);
    const edges = this.graph.topRelacoes(limite);
    return {
      snapshot: this.graph.snapshot(),
      nodes,
      edges,
      clusters: this.graph.clusters.slice(0, 30)
    };
  }

  async sugerirCadastro(rascunho) {
    await this._ensure();
    if (!this._catalogo.length) this._catalogo = await this._loadProdutos();
    if (!this._marcas.length) this._marcas = await this._all(`SELECT id, nome FROM marcas`);
    if (!this._categorias.length) this._categorias = await this._all(`SELECT id, nome FROM categorias`);
    return this.cadastro.sugerir(rascunho, this._catalogo, {
      marcas: this._marcas,
      categorias: this._categorias
    });
  }

  aplicarContextoBusca(req) {
    return aplicarContexto(req);
  }

  async dashboard() {
    await this._ensure();
    if (!this._catalogo.length) this._catalogo = await this._loadProdutos();
    const produtos = this._catalogo;
    const orfaos = produtos.filter((p) => !p.categoria_id && !p.marca_id).length;
    const semCat = produtos.filter((p) => !p.categoria_id).length;
    const semMarca = produtos.filter((p) => !p.marca_id).length;
    const semForn = produtos.filter((p) => !p.fornecedor_id).length;
    const dups = await this.detectDuplicates();
    return {
      graph: this.graph.snapshot(),
      topRelacoes: this.graph.topRelacoes(15),
      clusters: this.graph.clusters.slice(0, 20),
      duplicados: {
        produtos: (dups.produtos || []).length,
        gtin: (dups.gtin || []).length,
        marcas: (dups.marcas || []).length,
        categorias: (dups.categorias || []).length,
        amostra: (dups.produtos || []).slice(0, 8)
      },
      orfaos,
      semCategoria: semCat,
      semMarca,
      semFornecedor: semForn,
      totalProdutos: produtos.length
    };
  }

  /**
   * Consulta para MIIP — produtos semelhantes / GTIN / marca / categoria.
   */
  async consultarParaMiip(item = {}) {
    await this._ensure();
    if (!this._catalogo.length) this._catalogo = await this._loadProdutos();

    const gtin = String(item.gtin || item.codigo_barras || '').replace(/\D/g, '');
    let porGtin = null;
    if (gtin) {
      porGtin = this._catalogo.find((p) => String(p.codigo_barras || '').replace(/\D/g, '') === gtin) || null;
    }

    const sugestao = await this.sugerirCadastro({
      nome: item.nome || item.descricao,
      codigo_barras: gtin,
      ncm: item.ncm,
      preco_venda: item.preco
    });

    const similares = sugestao.produtos_semelhantes || [];
    return {
      encontradoPorGtin: porGtin
        ? { id: porGtin.id, nome: porGtin.nome, codigo: porGtin.codigo }
        : null,
      sugestaoCadastro: sugestao,
      similares,
      graph: {
        nos: this.graph.nodes.size,
        arestas: this.graph.snapshot().arestas
      }
    };
  }

  _loadProdutos() {
    return new Promise((resolve) => {
      const sqlFull = `SELECT id, codigo, codigo_barras, nome, nome_busca, preco_venda,
              categoria_id, marca_id, ncm, cfop, cest, ativo
       FROM produtos WHERE COALESCE(ativo, 1) = 1 ORDER BY id ASC LIMIT 20000`;
      const sqlSafe = `SELECT id, codigo, codigo_barras, nome, nome_busca, preco_venda,
              categoria_id, marca_id, ncm, cfop, ativo
       FROM produtos WHERE COALESCE(ativo, 1) = 1 ORDER BY id ASC LIMIT 20000`;
      this.db.all(sqlFull, [], (err, rows) => {
        if (!err) return resolve(rows || []);
        this.db.all(sqlSafe, [], (err2, rows2) => resolve(err2 ? [] : (rows2 || [])));
      });
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve) => {
      this.db.all(sql, params, (err, rows) => resolve(err ? [] : (rows || [])));
    });
  }

  _run(sql, params = []) {
    return new Promise((resolve) => {
      this.db.run(sql, params, () => resolve());
    });
  }
}

module.exports = KnowledgeService;
