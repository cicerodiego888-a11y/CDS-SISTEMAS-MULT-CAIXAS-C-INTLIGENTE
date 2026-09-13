'use strict';

const EventEmitter = require('events');

const EVENTOS = Object.freeze({
  ProdutoCriado: 'ProdutoCriado',
  ProdutoAlterado: 'ProdutoAlterado',
  ProdutoRemovido: 'ProdutoRemovido',
  ProdutoImportado: 'ProdutoImportado',
  CatalogoAtualizado: 'CatalogoAtualizado',
  SwapConcluido: 'SwapConcluido',
  HotCacheAtualizado: 'HotCacheAtualizado',
  BenchmarkConcluido: 'BenchmarkConcluido',
  MemoriaLimpa: 'MemoriaLimpa',
  // RC3.0 — Enterprise Search Observer
  SearchStarted: 'SearchStarted',
  SearchCompleted: 'SearchCompleted',
  SearchCacheHit: 'SearchCacheHit',
  SearchCacheMiss: 'SearchCacheMiss',
  SearchLearning: 'SearchLearning',
  SearchFailure: 'SearchFailure',
  // RC4.0 — Knowledge Graph
  KnowledgeRebuilt: 'KnowledgeRebuilt',
  RecommendationReady: 'RecommendationReady'
});

/**
 * Event bus interno do MIB — todos os módulos podem escutar.
 */
class EventBus extends EventEmitter {
  emitSafe(evento, payload) {
    try {
      return this.emit(evento, payload);
    } catch (err) {
      console.warn('[MIB][EventBus]', evento, err.message);
      return false;
    }
  }
}

module.exports = { EventBus, EVENTOS };
