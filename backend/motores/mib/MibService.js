'use strict';

const SearchEngine = require('./SearchEngine');
const BenchmarkEngine = require('./BenchmarkEngine');
const Diagnostics = require('./Diagnostics');
const { normalizarNomeBusca } = require('./core/normalizarNomeBusca');
const { garantirSchemaMib, backfillNomeBusca } = require('./schema/mibSchema');
const { MIB_VERSION, MIB_STATUS, MIB_CODIGO } = require('./version');
const { EVENTOS } = require('./events/EventBus');

/** @type {MibService|null} */
let singleton = null;

class MibService {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.engine = new SearchEngine(db);
    this.benchmark = new BenchmarkEngine(this.engine, db);
    this.diagnostics = new Diagnostics(this.engine);
    this._pronto = false;

    this.engine.events.on('BenchmarkAgendado', () => {
      this.executarBenchmark({ automatico: true }).catch(() => {});
    });
  }

  static getInstance(db) {
    if (!singleton) {
      singleton = new MibService(db || require('../../database'));
    } else if (db && singleton.db !== db) {
      singleton.db = db;
      singleton.engine = new SearchEngine(db);
      singleton.benchmark = new BenchmarkEngine(singleton.engine, db);
      singleton.diagnostics = new Diagnostics(singleton.engine);
      singleton._pronto = false;
    }
    return singleton;
  }

  static resetInstance() {
    if (singleton?.engine?.memoryMonitor) {
      singleton.engine.memoryMonitor.stop();
    }
    if (singleton?.engine?._benchmarkTimer) {
      clearInterval(singleton.engine._benchmarkTimer);
      singleton.engine._benchmarkTimer = null;
    }
    try {
      const SearchService = require('./enterprise/SearchService');
      SearchService.resetInstance();
    } catch (_) { /* ignore */ }
    singleton = null;
  }

  async iniciar() {
    await new Promise((resolve, reject) => {
      garantirSchemaMib(this.db, (err) => (err ? reject(err) : resolve()));
    });
    const pre = await this.engine.preaquecer();
    this._pronto = true;
    return {
      ok: true,
      versao: MIB_VERSION,
      status: MIB_STATUS,
      codigo: MIB_CODIGO,
      catalogo: pre.catalogo,
      hotCache: pre.hotCache,
      config: pre.config
    };
  }

  async _ensure() {
    if (!this._pronto) {
      try { await this.iniciar(); } catch (_) { /* best-effort */ }
    }
  }

  async buscar(termo, opcoes = {}) {
    await this._ensure();
    this.diagnostics.registrarConsulta();
    return this.engine.buscar(termo, opcoes);
  }

  gerarNomeBusca(nome) {
    return normalizarNomeBusca(nome);
  }

  sincronizarNomeBusca(produtoId, nome, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    const id = Number(produtoId);
    if (!id) return cb(null);
    const nb = normalizarNomeBusca(nome);
    this.db.run(
      `UPDATE produtos SET nome_busca = ? WHERE id = ?`,
      [nb, id],
      (err) => {
        if (!err) {
          this.engine.notificarProdutoAlterado(
            { id, nome, nome_busca: nb },
            EVENTOS.ProdutoAlterado
          );
        }
        cb(err || null);
      }
    );
  }

  notificarProdutoCriado(produto) {
    this.engine.notificarProdutoAlterado(produto, EVENTOS.ProdutoCriado);
  }

  notificarProdutoRemovido(id) {
    this.engine.notificarProdutoRemovido(id);
  }

  notificarProdutoImportado(info = {}) {
    this.engine.scheduleRefresh({ motivo: EVENTOS.ProdutoImportado, force: true });
    this.engine.events.emitSafe(EVENTOS.ProdutoImportado, info);
  }

  async refresh(opcoes = {}) {
    await this._ensure();
    const result = await this.engine.scheduleRefresh({
      motivo: opcoes.motivo || 'api_refresh',
      force: true
    });
    return result || this.engine.catalog.snapshot();
  }

  async rebuild() {
    await this._ensure();
    this.engine.invalidarCache();
    const result = await this.engine.catalog.rebuild();
    await this.engine.hotCache.rebuild(this.db, this.engine.catalog, this.engine.learning);
    return {
      catalogo: result,
      hotCache: this.engine.hotCache.stats()
    };
  }

  async rebuildHotCache() {
    await this._ensure();
    const info = await this.engine.hotCache.rebuild(
      this.db,
      this.engine.catalog,
      this.engine.learning
    );
    this.engine.events.emitSafe(EVENTOS.HotCacheAtualizado, info);
    return info;
  }

  /** @deprecated use refresh/rebuild */
  async recarregarCatalogo() {
    return this.rebuild().then((r) => ({
      produtos: r.catalogo.produtos,
      ...this.engine.catalog.snapshot()
    }));
  }

  backfill(opcoes, callback) {
    return backfillNomeBusca(this.db, opcoes, callback);
  }

  diagnostico() {
    const base = this.diagnostics.snapshot();
    const m = this.engine.snapshotMetricas();
    return {
      ...base,
      avancado: {
        catalogVersion: this.engine.catalog.versao,
        tempoConstrucaoMs: this.engine.catalog.snapshot().tempoConstrucaoMs
          || this.engine.catalog.atomic?.ultimoTempoConstrucaoMs
          || 0,
        produtosEmRam: this.engine.catalog.tamanho,
        tempoMedioBusca: m.statistics.tempoMedioMs,
        tempoMedioSql: m.statistics.tempoMedioSqlMs,
        tempoMedioCache: m.statistics.tempoMedioCacheMs,
        atualizacoes: m.catalogo.atualizacoes,
        swaps: m.catalogo.swaps,
        hotCache: m.hotCache.tamanho,
        memoria: m.memoria,
        estadoEngine: this._pronto ? 'ready' : 'starting',
        config: this.engine.config.snapshot(),
        updater: m.updater
      }
    };
  }

  health() {
    return this.engine.health();
  }

  async statistics() {
    await this._ensure();
    const snap = this.engine.stats.snapshot();
    const historico = await this.engine.stats.historicoBenchmark(20);
    return { ...snap, historicoBenchmark: historico };
  }

  catalogInfo() {
    const snap = this.engine.catalog.snapshot();
    const ativo = this.engine.catalog.ativo();
    return {
      ...snap,
      amostra: (ativo?.lista || []).slice(0, 20).map((p) => ({
        id: p.id,
        nome: p.nome,
        codigo: p.codigo,
        nome_busca: p.nome_busca
      }))
    };
  }

  async getConfig() {
    await this._ensure();
    return this.engine.config.snapshot();
  }

  async setConfig(patch) {
    await this._ensure();
    const saved = await this.engine.config.salvar(patch || {});
    this.engine.logger.setModoDesenvolvimento(saved.modoDesenvolvimento);
    this.engine.cache.setMax(saved.limiteCache);
    this.engine.hotCache.size = saved.hotCacheSize;
    this.engine.updater.setDebounceMs(saved.tempoRefreshMs);
    this.engine.learning.limitePreferencia = saved.limitePreferencia;
    return saved;
  }

  async executarBenchmark(opcoes = {}) {
    await this._ensure();
    const resultado = await this.benchmark.executar(opcoes);
    this.engine.stats.registrarBenchmark(resultado);
    this.engine.events.emitSafe(EVENTOS.BenchmarkConcluido, {
      automatico: Boolean(opcoes.automatico)
    });
    return resultado;
  }

  registrarSelecao(produtoId) {
    this.engine.registrarSelecao(produtoId);
  }

  async registrarAprendizado(payload) {
    await this._ensure();
    return this.engine.registrarAprendizado(payload || {});
  }

  async analytics() {
    await this._ensure();
    return this.engine.analytics.analytics();
  }

  async topSearches(limite) {
    await this._ensure();
    return this.engine.analytics.topSearches(limite);
  }

  async notFound(limite) {
    await this._ensure();
    return this.engine.analytics.notFound(limite);
  }

  async learningList(limite) {
    await this._ensure();
    return this.engine.analytics.learning(limite);
  }

  async cadastrarSinonimo(termo, sinonimo, origem) {
    await this._ensure();
    return this.engine.sinonimos.cadastrar(termo, sinonimo, origem || 'manual');
  }

  async listarSinonimos() {
    await this._ensure();
    return this.engine.sinonimos.listar();
  }

  async retrain() {
    await this._ensure();
    return this.engine.learning.retrain();
  }

  async resetLearning() {
    await this._ensure();
    return this.engine.learning.resetLearning();
  }

  on(evento, handler) {
    this.engine.events.on(evento, handler);
  }
}

module.exports = MibService;
