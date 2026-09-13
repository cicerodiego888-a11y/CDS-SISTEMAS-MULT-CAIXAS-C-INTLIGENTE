'use strict';

const AgentOrchestrator = require('./core/AgentOrchestrator');
const { CIA_VERSION, CIA_STATUS, CIA_CODIGO } = require('./version');

/** @type {CiaService|null} */
let singleton = null;

/**
 * CIA — CDS Intelligence Agent (copiloto oficial).
 * Não implementa regras de negócio nem consulta SQL de domínio.
 */
class CiaService {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.orchestrator = new AgentOrchestrator(db);
  }

  static getInstance(db) {
    if (!singleton) singleton = new CiaService(db);
    else if (db && singleton.db !== db) singleton = new CiaService(db);
    return singleton;
  }

  static resetInstance() {
    singleton = null;
  }

  status() {
    return {
      versao: CIA_VERSION,
      status: CIA_STATUS,
      codigo: CIA_CODIGO,
      principios: [
        'nao_implementa_regras_negocio',
        'nao_consulta_banco_de_negocio',
        'nao_substitui_motores',
        'apenas_orquestra_e_audita'
      ],
      tools: this.orchestrator.listarTools().length
    };
  }

  tools() {
    return this.orchestrator.listarTools();
  }

  chat(req, userCtx) {
    return this.orchestrator.chat(req, userCtx || {});
  }

  execute(req, userCtx) {
    return this.orchestrator.execute(req, userCtx || {});
  }

  history(userCtx, limite) {
    const ctx = {
      operador_id: userCtx?.id || userCtx?.operador_id,
      sessao_id: userCtx?.sessao_id || 'default'
    };
    return {
      conversa: this.orchestrator.memory.history(ctx, limite || 20),
      audit: null
    };
  }

  async auditHistory(limite) {
    return this.orchestrator.audit.history(limite || 30);
  }
}

module.exports = CiaService;
