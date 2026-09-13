'use strict';

const AdaptiveCache = require('../cache/AdaptiveCache');
const { EventBus, EVENTOS } = require('../events/EventBus');
const { criarProviders } = require('./providers');
const SearchPipeline = require('./SearchPipeline');
const IndexManager = require('./IndexManager');
const SearchTelemetry = require('./SearchTelemetry');
const AutoBenchmark = require('./AutoBenchmark');
const { autorizarProvider } = require('./permissions');

/** @type {SearchService|null} */
let singleton = null;

/**
 * SearchService — ponto único de pesquisa Enterprise (MIB-RC3.0).
 * Todos os módulos devem pesquisar exclusivamente por este serviço.
 */
class SearchService {
  /**
   * @param {import('sqlite3').Database} db
   * @param {import('../MibService')} mib
   */
  constructor(db, mib) {
    this.db = db;
    this.mib = mib;
    this.events = new EventBus();
    this.cache = new AdaptiveCache(400);
    this.providers = criarProviders(db, mib);
    this.pipeline = new SearchPipeline({
      sinonimos: mib?.engine?.sinonimos || null,
      cache: this.cache,
      learning: mib?.engine?.learning || null
    });
    this.indexManager = new IndexManager(db, this.providers);
    this.telemetry = new SearchTelemetry(db);
    this.benchmark = new AutoBenchmark(this, db);
    this._pronto = false;
  }

  static getInstance(db, mib) {
    if (!singleton) {
      if (!mib) {
        const MibService = require('../MibService');
        mib = MibService.getInstance(db);
      }
      singleton = new SearchService(db, mib);
    } else if (db && singleton.db !== db) {
      singleton = new SearchService(db, mib || singleton.mib);
    }
    return singleton;
  }

  static resetInstance() {
    if (singleton?.benchmark) singleton.benchmark.stop();
    singleton = null;
  }

  async iniciar() {
    await this.mib._ensure();
    this.pipeline.sinonimos = this.mib.engine.sinonimos;
    this.pipeline.learning = this.mib.engine.learning;
    await this.telemetry.garantirTabela();
    await this.benchmark.garantirTabela();
    await this.indexManager.rebuild();
    this.telemetry.start();
    this.benchmark.agendarDiario();
    this._pronto = true;
    return {
      ok: true,
      providers: this.listarProviders(),
      indices: await this.indexManager.validar()
    };
  }

  listarProviders() {
    const unicos = new Set();
    const out = [];
    for (const p of this.providers.values()) {
      if (unicos.has(p.entity)) continue;
      unicos.add(p.entity);
      out.push({
        entity: p.entity,
        aliases: p.aliases || [],
        permissao: p.permissao
      });
    }
    return out;
  }

  resolverProvider(entity) {
    const key = String(entity || 'produto').toLowerCase().trim();
    return this.providers.get(key) || null;
  }

  /**
   * Pesquisa universal.
   * @param {{
   *   entity: string,
   *   query: string,
   *   limite?: number,
   *   operador_id?: number,
   *   filial_id?: number,
   *   caixa_id?: number,
   *   origem?: string,
   *   modoFiscal?: boolean,
   *   permissoes?: string[],
   *   perfil?: string,
   *   role?: string,
   *   user?: object,
   *   skipAuth?: boolean
   * }} req
   */
  async search(req = {}) {
    if (!this._pronto) {
      try { await this.iniciar(); } catch (_) { /* best-effort */ }
    }

    // RC4.0 — contexto de módulo (sync, sem KnowledgeService no hot-path)
    let entity = String(req.entity || 'produto').toLowerCase();
    let searchContext = null;
    if (!req.entity || entity === 'auto' || entity === 'global') {
      try {
        const { aplicarContexto } = require('../knowledge/SearchContext');
        searchContext = aplicarContexto({ entity: req.entity, origem: req.origem, query: req.query || req.q });
        entity = searchContext.entity;
      } catch (_) {
        entity = 'produto';
      }
    }
    const query = String(req.query || req.q || '').trim();
    const inicio = process.hrtime.bigint();
    const mem0 = process.memoryUsage().heapUsed;

    this.events.emitSafe(EVENTOS.SearchStarted, { entity, query, origem: req.origem, contexto: searchContext?.contexto });

    const provider = this.resolverProvider(entity);
    if (!provider) {
      const err = new Error(`Entidade não suportada: ${entity}`);
      err.code = 'SEARCH_ENTITY_UNKNOWN';
      this.events.emitSafe(EVENTOS.SearchFailure, { entity, query, error: err.message });
      throw err;
    }

    if (!req.skipAuth) {
      const auth = autorizarProvider(provider, req);
      if (!auth.ok) {
        const err = new Error('Sem permissão para pesquisar esta entidade');
        err.code = 'SEARCH_FORBIDDEN';
        err.motivo = auth.motivo;
        this.events.emitSafe(EVENTOS.SearchFailure, { entity, query, error: err.message });
        throw err;
      }
    }

    const preprocessado = this.pipeline.preprocess(query);
    const ctx = {
      limite: req.limite || 20,
      operador_id: req.operador_id,
      filial_id: req.filial_id,
      caixa_id: req.caixa_id,
      origem: req.origem || 'api',
      modoFiscal: req.modoFiscal,
      permissoes: req.permissoes,
      perfil: req.perfil,
      role: req.role,
      user: req.user,
      entityAlias: entity
    };

    const chave = this.pipeline.chaveCache(provider.entity, preprocessado, ctx);
    const cachedEntry = this.pipeline.getCache(chave);
    const cachedItens = cachedEntry?.itens;
    if (Array.isArray(cachedItens)) {
      this.events.emitSafe(EVENTOS.SearchCacheHit, { entity, query });
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      this.telemetry.registrar({
        entity: provider.entity,
        query,
        provider: provider.entity,
        tempo_ms: ms,
        cache_hit: true,
        resultados: cachedItens.length,
        operador_id: ctx.operador_id,
        filial_id: ctx.filial_id,
        origem: ctx.origem,
        ram_mb: Number(((process.memoryUsage().heapUsed - mem0) / 1024 / 1024).toFixed(3))
      });
      this.events.emitSafe(EVENTOS.SearchCompleted, { entity, query, tempoMs: ms, cache: true });
      return {
        entity: provider.entity,
        itens: cachedItens,
        meta: {
          fonte: 'cache',
          tempoMs: Number(ms.toFixed(3)),
          tokens: preprocessado.tokens,
          provider: provider.entity,
          ...(cachedEntry.meta || {})
        }
      };
    }

    this.events.emitSafe(EVENTOS.SearchCacheMiss, { entity, query });

    let resultado;
    try {
      resultado = await provider.search(query, ctx);
    } catch (err) {
      this.events.emitSafe(EVENTOS.SearchFailure, { entity, query, error: err.message });
      this.telemetry.registrar({
        entity: provider.entity,
        query,
        tempo_ms: Number(process.hrtime.bigint() - inicio) / 1e6,
        ok: false,
        origem: ctx.origem,
        operador_id: ctx.operador_id,
        filial_id: ctx.filial_id
      });
      throw err;
    }

    const itens = resultado.itens || [];
    this.pipeline.setCache(chave, itens, resultado.meta);

    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const rankingTop = itens[0]?._score ?? itens[0]?.mib_score ?? null;

    this.telemetry.registrar({
      entity: provider.entity,
      query,
      provider: provider.entity,
      tempo_ms: ms,
      cache_hit: false,
      resultados: itens.length,
      operador_id: ctx.operador_id,
      filial_id: ctx.filial_id,
      origem: ctx.origem,
      ranking_top: rankingTop,
      cpu_ms: ms,
      ram_mb: Number(((process.memoryUsage().heapUsed - mem0) / 1024 / 1024).toFixed(3))
    });

    this.events.emitSafe(EVENTOS.SearchCompleted, {
      entity: provider.entity,
      query,
      tempoMs: ms,
      resultados: itens.length
    });

    return {
      entity: provider.entity,
      itens,
      meta: {
        ...(resultado.meta || {}),
        tempoMs: Number(ms.toFixed(3)),
        tokens: preprocessado.tokens,
        tokensExpandidos: preprocessado.tokensExpandidos,
        provider: provider.entity,
        fonte: resultado.meta?.fonte || 'provider'
      }
    };
  }

  async learn(payload = {}) {
    this.events.emitSafe(EVENTOS.SearchLearning, payload);
    if (this.mib?.registrarAprendizado) {
      return this.mib.registrarAprendizado(payload);
    }
    return null;
  }

  async rebuild() {
    const idx = await this.indexManager.rebuild();
    if (this.mib?.rebuild) {
      const cat = await this.mib.rebuild();
      return { indices: idx, catalogo: cat };
    }
    return { indices: idx };
  }

  statistics() {
    const tel = this.telemetry.snapshot();
    const mem = process.memoryUsage();
    return {
      ...tel,
      providersAtivos: this.listarProviders().length,
      providers: this.listarProviders(),
      cache: this.cache.stats ? this.cache.stats() : { hits: this.cache.hits, misses: this.cache.misses },
      ram: {
        heapUsed: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        rss: Number((mem.rss / 1024 / 1024).toFixed(1))
      },
      aprendizado: this.mib?.engine?.learning?.stats?.() || null,
      sinonimos: this.mib?.engine?.sinonimos?.stats?.() || null
    };
  }

  async enterpriseDashboard() {
    const stats = this.statistics();
    const diag = await this.indexManager.diagnosticar();
    const bench = await this.benchmark.historico(20);
    const hist = await this.telemetry.historico(30);
    return {
      ...stats,
      indices: diag,
      benchmark: bench,
      historico: hist,
      topPesquisas: this._topFromMem(stats.amostra || [])
    };
  }

  _topFromMem(amostra) {
    const map = new Map();
    for (const r of amostra) {
      const k = `${r.entity}|${r.query}`;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()]
      .map(([k, count]) => {
        const [entity, query] = k.split('|');
        return { entity, query, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }

  on(evento, handler) {
    this.events.on(evento, handler);
  }
}

module.exports = SearchService;
