'use strict';

const KnowledgeService = require('./KnowledgeService');
const KnowledgeGraph = require('./KnowledgeGraph');
const SimilarityEngine = require('./SimilarityEngine');
const RecommendationEngine = require('./RecommendationEngine');
const ClusterEngine = require('./ClusterEngine');
const DuplicateDetector = require('./DuplicateDetector');
const SalesLearning = require('./SalesLearning');
const CadastroSuggestionEngine = require('./CadastroSuggestionEngine');
const { aplicarContexto, CONTEXTO_PRIORIDADE } = require('./SearchContext');
const { MiipKnowledgeBridge, consultarGrafoMiip } = require('./MiipKnowledgeBridge');
const { NODE_TYPES, REL } = require('./relations');

function obterKnowledge(db) {
  return KnowledgeService.getInstance(db);
}

module.exports = {
  KnowledgeService,
  KnowledgeGraph,
  SimilarityEngine,
  RecommendationEngine,
  ClusterEngine,
  DuplicateDetector,
  SalesLearning,
  CadastroSuggestionEngine,
  MiipKnowledgeBridge,
  consultarGrafoMiip,
  obterKnowledge,
  aplicarContexto,
  CONTEXTO_PRIORIDADE,
  NODE_TYPES,
  REL
};
