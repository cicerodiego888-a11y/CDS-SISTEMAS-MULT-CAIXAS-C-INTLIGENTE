'use strict';

const { normalizarTermoBusca } = require('./core/normalizarNomeBusca');
const QueryOptimizer = require('./core/QueryOptimizer');
const RankingEngine = require('./core/RankingEngine');
const LearningEngine = require('./core/LearningEngine');
const SinonimosService = require('./core/SinonimosService');
const AdaptiveCache = require('./cache/AdaptiveCache');
const CacheEngine = require('./cache/CacheEngine');
const HotCache = require('./cache/HotCache');
const CatalogMemory = require('./catalog/CatalogMemory');
const CatalogUpdater = require('./catalog/CatalogUpdater');
const MibConfig = require('./config/MibConfig');
const MibLogger = require('./observability/MibLogger');
const StatisticsEngine = require('./observability/StatisticsEngine');
const MemoryMonitor = require('./observability/MemoryMonitor');
const AnalyticsEngine = require('./observability/AnalyticsEngine');
const SearchAI = require('./ai/SearchAI');
const { EventBus, EVENTOS } = require('./events/EventBus');

/**
 * Motor Cognitivo de Busca RC2.0 —
 * HotCache → Cache → Preferência → Tokens/Sinônimos → Catálogo → Fuzzy → SQL.
 */
class SearchEngine {
  /**
   * @param {import('sqlite3').Database} db
   * @param {object} [opcoes]
   */
  constructor(db, opcoes = {}) {
    this.db = db;
    this.config = new MibConfig(db);
    this.logger = new MibLogger({ modoDesenvolvimento: false });
    this.events = new EventBus();
    this.stats = new StatisticsEngine(db);

    this.cache = new AdaptiveCache(opcoes.cacheMax || 300);
    this.cacheEngine = this.cache;
    this._CacheEngineLegacy = CacheEngine;

    this.hotCache = new HotCache({ size: 100 });
    this.catalog = new CatalogMemory(db, {
      logger: this.logger,
      onSwap: (info) => {
        this.stats.registrarSwap(info);
        this.events.emitSafe(EVENTOS.SwapConcluido, info);
        this.events.emitSafe(EVENTOS.CatalogoAtualizado, info);
      }
    });
    this.updater = new CatalogUpdater(this.catalog, {
      debounceMs: 400,
      logger: this.logger,
      invalidarCache: () => this.invalidarCachePesquisas(),
      onUpdated: (info) => this.events.emitSafe(EVENTOS.CatalogoAtualizado, info)
    });

    this.learning = new LearningEngine(db, { limitePreferencia: 3 });
    this.sinonimos = new SinonimosService(db);
    this.ranking = new RankingEngine(this.learning);
    this.searchAI = new SearchAI({
      sinonimos: this.sinonimos,
      learning: this.learning,
      catalog: this.catalog,
      config: this.config
    });
    this.analytics = new AnalyticsEngine(db, {
      learning: this.learning,
      sinonimos: this.sinonimos,
      engine: this,
      stats: this.stats
    });
    this.optimizer = new QueryOptimizer(db);
    this.memoryMonitor = new MemoryMonitor({
      cache: this.cache,
      hotCache: this.hotCache,
      config: this.config,
      logger: this.logger,
      onTrim: (info) => this.events.emitSafe(EVENTOS.MemoriaLimpa, info)
    });

    this._seq = 0;
    this._atual = null;
    this._incremental = null;
    this._inicio = Date.now();
    this._benchmarkTimer = null;

    this.metricas = {
      consultas: 0,
      sql: 0,
      cache: 0,
      hotcache: 0,
      memoria: 0,
      incremental: 0,
      fuzzy: 0,
      sinonimo: 0,
      canceladas: 0,
      temposMs: []
    };
  }

  /**
   * Pré-aquecimento RC2.0.
   */
  async preaquecer() {
    await this.config.carregar();
    this.logger.setModoDesenvolvimento(this.config.get('modoDesenvolvimento'));
    this.cache.setMax(this.config.get('limiteCache'));
    this.hotCache.size = this.config.get('hotCacheSize');
    this.updater.setDebounceMs(this.config.get('tempoRefreshMs'));
    this.learning.limitePreferencia = this.config.get('limitePreferencia');

    await this.stats.carregar();
    await this.sinonimos.carregar();
    await this.catalog.garantir();
    await new Promise((resolve) => {
      this.learning.hidratarDoBanco(this.db, () => resolve());
    });
    await this.hotCache.rebuild(this.db, this.catalog, this.learning);
    this.events.emitSafe(EVENTOS.HotCacheAtualizado, this.hotCache.stats());

    this.memoryMonitor.start(15000);
    this._agendarBenchmarkDiario();
    return {
      catalogo: this.catalog.snapshot(),
      hotCache: this.hotCache.stats(),
      config: this.config.snapshot(),
      sinonimos: this.sinonimos.stats()
    };
  }

  _agendarBenchmarkDiario() {
    if (this._benchmarkTimer) clearInterval(this._benchmarkTimer);
    if (!this.config.get('ativarBenchmark')) return;
    const horas = Number(this.config.get('benchmarkIntervaloHoras')) || 24;
    const ms = Math.max(3600000, horas * 3600000);
    this._benchmarkTimer = setInterval(() => {
      // lazy — BenchmarkEngine chamado pelo MibService se disponível
      this.events.emitSafe('BenchmarkAgendado', { em: new Date().toISOString() });
    }, ms);
    if (this._benchmarkTimer.unref) this._benchmarkTimer.unref();
  }

  cancelarAtual() {
    if (this._atual && !this._atual.cancelled) {
      this._atual.cancelled = true;
      this.metricas.canceladas += 1;
    }
  }

  /**
   * @param {string} termo
   * @param {{
   *   limite?: number,
   *   modoFiscal?: boolean|number|string,
   *   operador_id?: number,
   *   filial_id?: number,
   *   caixa_id?: number
   * }} [opcoes]
   */
  async buscar(termo, opcoes = {}) {
    const inicio = process.hrtime.bigint();
    this.cancelarAtual();

    const id = ++this._seq;
    const signal = { id, cancelled: false };
    this._atual = signal;
    this.metricas.consultas += 1;

    const termoRaw = String(termo || '').trim();
    const interpretado = this.searchAI.interpretar(termoRaw, {
      operador_id: opcoes.operador_id
    });
    const termoNorm = interpretado.normalizado || normalizarTermoBusca(termoRaw);
    const limite = Math.min(Math.max(Number(opcoes.limite) || 20, 1), 100);
    const modoFiscal = opcoes.modoFiscal === true
      || opcoes.modoFiscal === 1
      || opcoes.modoFiscal === '1';
    const rankCtx = {
      termoNorm,
      termoRaw,
      tokensNorm: interpretado.tokensNorm,
      tokensExpandidos: interpretado.tokensExpandidos,
      operador_id: opcoes.operador_id,
      filial_id: opcoes.filial_id
    };

    const chaveCache = `${modoFiscal ? 'F' : 'N'}|${opcoes.operador_id || 0}|${limite}|${termoNorm}`;

    const obterPreferido = () => {
      if (!interpretado.preferidoId || !this.config.get('ativarAprendizado')) return null;
      const pref = this.catalog.atomic.get(interpretado.preferidoId);
      if (!pref) return null;
      if (modoFiscal && Number(pref.item_fiscal) !== 1) return null;
      return pref;
    };

    const finalizar = (itens, meta) => {
      if (signal.cancelled) {
        const err = new Error('MIB_CANCELLED');
        err.code = 'MIB_CANCELLED';
        throw err;
      }
      const candidatos = Array.isArray(itens) ? itens.slice() : [];
      const preferido = obterPreferido();
      if (preferido && !candidatos.some((p) => Number(p.id) === Number(preferido.id))) {
        candidatos.unshift({
          ...preferido,
          preco_venda: preferido.preco,
          match_exato: 0,
          _matchTipo: { preferencia: true }
        });
      }
      const ranqueados = this.ranking.ordenar(candidatos, {
        ...rankCtx,
        estrategia: meta.estrategia
      })
        .slice(0, limite)
        .map((p) => ({
          ...p,
          match_exato: p.match_exato || (p.mib_score >= 90 ? 1 : 0)
        }));

      if (meta.fonte !== 'cache' && meta.fonte !== 'hotcache' && ranqueados.length > 0) {
        this.cache.set(chaveCache, ranqueados, meta);
      }

      this._incremental = {
        termoNorm: termoNorm || termoRaw.toLowerCase(),
        itens: ranqueados,
        fonte: meta.fonte
      };

      const fim = process.hrtime.bigint();
      const ms = Number(fim - inicio) / 1e6;
      this.metricas.temposMs.push(ms);
      if (this.metricas.temposMs.length > 200) this.metricas.temposMs.shift();

      if (this.config.get('ativarEstatisticas')) {
        this.stats.registrarBusca({
          tempoMs: ms,
          fonte: meta.fonte,
          produtoIds: ranqueados.map((p) => p.id)
        });
      }

      // aprendizado assíncrono da pesquisa (sem produto ainda)
      if (this.config.get('ativarAprendizado') && !ranqueados.length) {
        this.learning.registrarEvento({
          texto: termoRaw,
          operador_id: opcoes.operador_id,
          filial_id: opcoes.filial_id,
          caixa_id: opcoes.caixa_id,
          tempo_ms: ms
        }).catch(() => {});
      }

      return {
        itens: ranqueados,
        meta: {
          ...meta,
          termo: termoRaw,
          termoNorm,
          tokens: interpretado.tokens,
          tempoMs: Number(ms.toFixed(3)),
          requestId: id,
          catalogVersion: this.catalog.versao,
          sugestao: meta.sugestao || null
        }
      };
    };

    try {
      if (!termoRaw) {
        return finalizar([], { fonte: 'vazio', estrategia: null });
      }

      // 0) Preferência aprendida NÃO encerra a busca: entra no ranking
      // como desempate. Um NOME_EXATO precisa poder superá-la.

      // 1) HotCache
      const hot = this.hotCache.buscar(termoNorm, termoRaw, { limite, modoFiscal });
      if (hot.length > 0) {
        this.metricas.hotcache += 1;
        return finalizar(hot, { fonte: 'hotcache', estrategia: 'hotcache' });
      }

      // 2) Adaptive cache
      const cached = this.cache.get(chaveCache);
      if (cached && Array.isArray(cached.itens)) {
        this.metricas.cache += 1;
        const fim = process.hrtime.bigint();
        const ms = Number(fim - inicio) / 1e6;
        this.metricas.temposMs.push(ms);
        if (this.config.get('ativarEstatisticas')) {
          this.stats.registrarBusca({
            tempoMs: ms,
            fonte: 'cache',
            produtoIds: cached.itens.map((p) => p.id)
          });
        }
        return {
          itens: cached.itens.slice(0, limite),
          meta: {
            fonte: 'cache',
            estrategia: cached.meta?.estrategia || null,
            termo: termoRaw,
            termoNorm,
            tempoMs: Number(ms.toFixed(3)),
            requestId: id,
            catalogVersion: this.catalog.versao
          }
        };
      }

      // 3) Incremental
      const prev = this._incremental;
      const termoInc = termoNorm || termoRaw.toLowerCase();
      if (
        prev
        && prev.termoNorm
        && termoInc.startsWith(prev.termoNorm)
        && prev.termoNorm.length >= 2
        && Array.isArray(prev.itens)
        && prev.itens.length > 0
      ) {
        this.metricas.incremental += 1;
        const filtrados = this.catalog.filtrar(termoInc, {
          limite,
          modoFiscal,
          base: prev.itens.map((p) => ({
            ...p,
            nome_busca: p.nome_busca || normalizarTermoBusca(p.nome)
          }))
        });
        // Só reaproveita o prefixo quando ainda há hits. Lista vazia NÃO
        // encerra a busca: o nome completo (02M vs 2M, acento, marca)
        // pode existir no catálogo mesmo que o recorte anterior não o tivesse.
        if (filtrados.length > 0) {
          return finalizar(filtrados, {
            fonte: 'incremental',
            estrategia: 'incremental'
          });
        }
      }

      await this.catalog.garantir();
      if (signal.cancelled) throw Object.assign(new Error('MIB_CANCELLED'), { code: 'MIB_CANCELLED' });

      // 4) Tokens + sinônimos — EAN/PLU/código interno vão ao catálogo, não ao nome
      const soDigitos = /^\d+$/.test(termoRaw.replace(/\s+/g, ''))
        || /^\d+$/.test(String(termoNorm || ''));
      if (!soDigitos && interpretado.tokensExpandidos.length > 0) {
        const porToken = this.searchAI.buscarPorTokens(interpretado.tokensExpandidos, {
          limite,
          modoFiscal,
          tokensOriginais: interpretado.tokensNorm
        });
        if (porToken.length > 0) {
          if (porToken.some((p) => p._matchTipo?.sinonimo)) this.metricas.sinonimo += 1;
          else this.metricas.memoria += 1;
          return finalizar(porToken, {
            fonte: 'memoria',
            estrategia: porToken.some((p) => p._matchTipo?.sinonimo) ? 'sinonimo' : 'tokens'
          });
        }
      }

      // 5) Catálogo exato/prefixo
      const mem = this.catalog.filtrar(termoNorm || termoRaw.toLowerCase(), { limite, modoFiscal });
      if (mem.length > 0) {
        this.metricas.memoria += 1;
        const termoCmp = termoRaw.toLowerCase();
        const itens = mem.map((p) => {
          const exato = String(p.codigo || '').toLowerCase() === termoCmp
            || String(p.codigo_barras || '').toLowerCase() === termoCmp
            || String(p.plu || '').toLowerCase() === termoCmp;
          return {
            id: p.id,
            codigo: p.codigo,
            codigo_barras: p.codigo_barras,
            nome: p.nome,
            nome_busca: p.nome_busca,
            plu: p.plu,
            preco_venda: p.preco,
            marca: p.marca,
            item_fiscal: p.item_fiscal,
            match_exato: exato ? 1 : 0
          };
        });
        return finalizar(itens, { fonte: 'memoria', estrategia: 'catalogo' });
      }

      // 6) Fuzzy + auto correção
      const fuzzy = this.searchAI.buscarFuzzy(termoNorm, { limite, modoFiscal });
      if (fuzzy.itens.length > 0) {
        this.metricas.fuzzy += 1;
        const sugestao = this.searchAI.sugerirCorrecao(termoRaw, fuzzy);
        return finalizar(fuzzy.itens, {
          fonte: 'fuzzy',
          estrategia: 'fuzzy',
          sugestao
        });
      }

      // 7) SQL fallback
      this.metricas.sql += 1;
      const sqlResult = await this.optimizer.buscar({
        termoRaw,
        termoNorm,
        limite,
        modoFiscal,
        signal
      });
      if (signal.cancelled) throw Object.assign(new Error('MIB_CANCELLED'), { code: 'MIB_CANCELLED' });

      if ((sqlResult.itens || []).length === 0) {
        const sugestao = this.searchAI.sugerirCorrecao(termoRaw, fuzzy);
        return finalizar([], { fonte: 'sql', estrategia: null, sugestao });
      }

      return finalizar(sqlResult.itens || [], {
        fonte: 'sql',
        estrategia: sqlResult.estrategia
      });
    } catch (err) {
      if (err && err.code === 'MIB_CANCELLED') throw err;
      throw err;
    } finally {
      if (this._atual && this._atual.id === id) this._atual = null;
    }
  }

  invalidarCachePesquisas() {
    this.cache.clear(false);
    this._incremental = null;
  }

  invalidarCache() {
    this.invalidarCachePesquisas();
  }

  scheduleRefresh(opcoes = {}) {
    if (!this.config.get('ativarAtualizacaoAutomatica') && !opcoes.force) {
      return Promise.resolve(null);
    }
    return this.updater.scheduleRefresh(opcoes);
  }

  notificarProdutoAlterado(produto, evento = EVENTOS.ProdutoAlterado) {
    this.scheduleRefresh({
      motivo: evento,
      force: true,
      patch: { upsert: produto }
    });
    this.events.emitSafe(evento, { produto });
  }

  notificarProdutoRemovido(id) {
    this.scheduleRefresh({
      motivo: EVENTOS.ProdutoRemovido,
      patch: { removeId: id }
    });
    this.events.emitSafe(EVENTOS.ProdutoRemovido, { id });
  }

  registrarSelecao(produtoId) {
    this.learning.registrarSelecao(produtoId);
  }

  /**
   * Feedback de seleção (aprendizado RC2).
   */
  async registrarAprendizado(payload = {}) {
    if (!this.config.get('ativarAprendizado')) {
      return { ok: false, motivo: 'aprendizado_desativado' };
    }
    const result = await this.learning.registrarEvento(payload);
    if (payload.produto_id && payload.texto && this.config.get('ativarSinonimos')) {
      // nome do produto se disponível
      const prod = this.catalog.atomic.get(payload.produto_id);
      if (prod?.nome) {
        await this.sinonimos.aprenderDeSelecao(payload.texto, prod.nome);
      }
    }
    return { ok: true, ...result };
  }

  snapshotMetricas() {
    const tempos = this.metricas.temposMs;
    const media = tempos.length
      ? tempos.reduce((a, b) => a + b, 0) / tempos.length
      : 0;
    const max = tempos.length ? Math.max(...tempos) : 0;
    return {
      ...this.metricas,
      tempoMedioMs: Number(media.toFixed(3)),
      tempoMaxMs: Number(max.toFixed(3)),
      cache: this.cache.stats(),
      hotCache: this.hotCache.stats(),
      catalogo: this.catalog.snapshot(),
      updater: this.updater.stats(),
      learning: this.learning.stats(),
      statistics: this.stats.snapshot(),
      memoria: this.memoryMonitor.usoMb(),
      uptimeSec: Math.round((Date.now() - this._inicio) / 1000)
    };
  }

  health() {
    const m = this.snapshotMetricas();
    const st = this.stats.snapshot();
    return {
      status: this.catalog.ultimoErro ? 'degraded' : 'ok',
      catalogVersion: this.catalog.versao,
      catalogSize: this.catalog.tamanho,
      cacheHits: m.cache.hits,
      cacheMiss: m.cache.misses,
      hotCacheHits: m.hotCache.hits,
      memoryUsage: m.memoria,
      uptime: m.uptimeSec,
      lastRefresh: this.catalog.snapshot().ultimoRefreshEm,
      lastSwap: this.catalog.snapshot().ultimoSwapEm,
      lastBenchmark: st.lastBenchmark,
      avgSearch: st.tempoMedioMs,
      engine: 'MIB',
      version: require('./version').MIB_VERSION
    };
  }
}

module.exports = SearchEngine;
