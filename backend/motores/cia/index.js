'use strict';

/**
 * CIA — CDS Intelligence Agent RC1.0 (Copiloto oficial)
 * @module motores/cia
 */

const CiaService = require('./CiaService');
const AgentSDK = require('./AgentSDK');
const AgentOrchestrator = require('./core/AgentOrchestrator');
const IntentEngine = require('./core/IntentEngine');
const Planner = require('./core/Planner');
const { criarToolRegistry } = require('./core/ToolRegistry');
const { autorizar } = require('./core/AgentPermissions');
const { CIA_VERSION, CIA_STATUS, CIA_CODIGO, CIA_RELEASE_DATE } = require('./version');

function obterCia(db) {
  return CiaService.getInstance(db);
}

function obterAgentSDK(db) {
  return AgentSDK.fromDb(db);
}

module.exports = {
  CIA_VERSION,
  CIA_STATUS,
  CIA_CODIGO,
  CIA_RELEASE_DATE,
  CiaService,
  AgentSDK,
  AgentOrchestrator,
  IntentEngine,
  Planner,
  criarToolRegistry,
  autorizar,
  obterCia,
  obterAgentSDK
};
