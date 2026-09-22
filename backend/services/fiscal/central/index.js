/**
 * Política operacional da Central (Sprint 5).
 * ASSISTIDO / AUTOMÁTICO — ações seguras com proteções SEFAZ preservadas.
 */
'use strict';

const CentralOperationModes = require('./CentralOperationModes');
const CentralActionTypes = require('./CentralActionTypes');
const CentralOperationPolicy = require('./CentralOperationPolicy');
const CentralOperationConfigStore = require('./CentralOperationConfigStore');
const CentralOperationOrchestrator = require('./CentralOperationOrchestrator');
const CentralActionQueue = require('./CentralActionQueue');
const CentralActionAuditoria = require('./CentralActionAuditoria');
const CentralActionId = require('./CentralActionId');
const { avaliarProtecoesOperacionais } = require('./CentralOperationProtecoes');

let _orchestrator = null;

function obterOrchestratorOperacao(deps) {
  if (deps) return new CentralOperationOrchestrator(deps);
  if (!_orchestrator) {
    let configRepository = null;
    try {
      configRepository = new (require('../../../motores/central-entradas/repositories/CentralConfiguracaoRepository'))();
    } catch { /* ignore */ }
    let emitirEvento = null;
    try {
      emitirEvento = require('../../../motores/central-entradas/utils/centralEventosEmitter').emitirEvento;
    } catch { /* ignore */ }
    _orchestrator = new CentralOperationOrchestrator({
      configRepository,
      emitirEvento
    });
  }
  return _orchestrator;
}

module.exports = {
  ...CentralOperationModes,
  ...CentralActionTypes,
  ...CentralActionId,
  CentralOperationPolicy,
  CentralOperationConfigStore,
  CentralOperationOrchestrator,
  CentralActionQueue,
  CentralActionAuditoria,
  obterOrchestratorOperacao,
  avaliarProtecoesOperacionais,
  defaultsKv: CentralOperationConfigStore.defaultsKv,
  CHAVES_OPERACAO: CentralOperationConfigStore.CHAVES
};
