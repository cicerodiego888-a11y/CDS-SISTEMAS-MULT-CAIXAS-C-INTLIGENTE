'use strict';

/**
 * Motor de Conhecimento / Enterprise Search — MIB RC4.0
 * Knowledge Graph, recomendações, similaridade, SearchService.
 * @module motores/mib
 */

const MibService = require('./MibService');
const SearchEngine = require('./SearchEngine');
const CacheEngine = require('./cache/CacheEngine');
const AdaptiveCache = require('./cache/AdaptiveCache');
const HotCache = require('./cache/HotCache');
const CatalogMemory = require('./catalog/CatalogMemory');
const AtomicCatalog = require('./catalog/AtomicCatalog');
const CatalogUpdater = require('./catalog/CatalogUpdater');
const RankingEngine = require('./core/RankingEngine');
const QueryOptimizer = require('./core/QueryOptimizer');
const LearningEngine = require('./core/LearningEngine');
const SinonimosService = require('./core/SinonimosService');
const SearchAI = require('./ai/SearchAI');
const BenchmarkEngine = require('./BenchmarkEngine');
const Diagnostics = require('./Diagnostics');
const StatisticsEngine = require('./observability/StatisticsEngine');
const MemoryMonitor = require('./observability/MemoryMonitor');
const AnalyticsEngine = require('./observability/AnalyticsEngine');
const MibConfig = require('./config/MibConfig');
const { EventBus, EVENTOS } = require('./events/EventBus');
const { normalizarNomeBusca, normalizarTermoBusca } = require('./core/normalizarNomeBusca');
const { tokenizar } = require('./core/tokenizer');
const { levenshtein } = require('./core/levenshtein');
const { garantirSchemaMib, backfillNomeBusca } = require('./schema/mibSchema');
const { MIB_VERSION, MIB_STATUS, MIB_RELEASE_DATE, MIB_CODIGO } = require('./version');

const SearchService = require('./enterprise/SearchService');
const SearchSDK = require('./enterprise/SearchSDK');
const SearchPipeline = require('./enterprise/SearchPipeline');
const IndexManager = require('./enterprise/IndexManager');
const SearchTelemetry = require('./enterprise/SearchTelemetry');
const AutoBenchmark = require('./enterprise/AutoBenchmark');
const { autorizarProvider } = require('./enterprise/permissions');
const providers = require('./enterprise/providers');

const knowledge = require('./knowledge');
const {
  KnowledgeService,
  obterKnowledge,
  consultarGrafoMiip,
  MiipKnowledgeBridge,
  SimilarityEngine,
  RecommendationEngine,
  ClusterEngine,
  DuplicateDetector,
  aplicarContexto,
  NODE_TYPES,
  REL
} = knowledge;

function obterMib(db) {
  return MibService.getInstance(db);
}

function obterSearchService(db) {
  const mib = obterMib(db);
  return SearchService.getInstance(db, mib);
}

function obterSearchSDK(db) {
  return SearchSDK.fromDb(db);
}

module.exports = {
  MIB_VERSION,
  MIB_STATUS,
  MIB_RELEASE_DATE,
  MIB_CODIGO,
  MibService,
  SearchEngine,
  CacheEngine,
  AdaptiveCache,
  HotCache,
  CatalogMemory,
  AtomicCatalog,
  CatalogUpdater,
  RankingEngine,
  QueryOptimizer,
  LearningEngine,
  SinonimosService,
  SearchAI,
  BenchmarkEngine,
  Diagnostics,
  StatisticsEngine,
  MemoryMonitor,
  AnalyticsEngine,
  MibConfig,
  EventBus,
  EVENTOS,
  // RC3.0 Enterprise
  SearchService,
  SearchSDK,
  SearchPipeline,
  IndexManager,
  SearchTelemetry,
  AutoBenchmark,
  autorizarProvider,
  providers,
  // RC4.0 Knowledge
  KnowledgeService,
  SimilarityEngine,
  RecommendationEngine,
  ClusterEngine,
  DuplicateDetector,
  MiipKnowledgeBridge,
  consultarGrafoMiip,
  obterKnowledge,
  aplicarContexto,
  NODE_TYPES,
  REL,
  normalizarNomeBusca,
  normalizarTermoBusca,
  tokenizar,
  levenshtein,
  garantirSchemaMib,
  backfillNomeBusca,
  obterMib,
  obterSearchService,
  obterSearchSDK
};
