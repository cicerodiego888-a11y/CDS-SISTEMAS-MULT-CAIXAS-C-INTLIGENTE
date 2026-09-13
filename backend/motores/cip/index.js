'use strict';

/**
 * CIP — CDS Intelligence Platform RC1.0
 * @module motores/cip
 */

const CipService = require('./CipService');
const DecisionEngine = require('./core/DecisionEngine');
const { ContextEngine, CONTEXTS } = require('./core/ContextEngine');
const ForecastEngine = require('./core/ForecastEngine');
const BusinessRuleEngine = require('./core/BusinessRuleEngine');
const AutomationEngine = require('./core/AutomationEngine');
const RecommendationHub = require('./core/RecommendationHub');
const { coletarSinais } = require('./adapters/MotorAdapters');
const { CIP_VERSION, CIP_STATUS, CIP_CODIGO, CIP_RELEASE_DATE } = require('./version');

function obterCip(db) {
  return CipService.getInstance(db);
}

module.exports = {
  CIP_VERSION,
  CIP_STATUS,
  CIP_CODIGO,
  CIP_RELEASE_DATE,
  CipService,
  DecisionEngine,
  ContextEngine,
  ForecastEngine,
  BusinessRuleEngine,
  AutomationEngine,
  RecommendationHub,
  CONTEXTS,
  coletarSinais,
  obterCip
};
