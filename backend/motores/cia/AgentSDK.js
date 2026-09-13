'use strict';

/**
 * AgentSDK — biblioteca interna (server + espelho no frontend).
 */
class AgentSDK {
  /**
   * @param {import('./CiaService')} service
   */
  constructor(service) {
    this.service = service;
  }

  static fromDb(db) {
    const CiaService = require('./CiaService');
    return new AgentSDK(CiaService.getInstance(db));
  }

  chat(params, userCtx) {
    return this.service.chat(params, userCtx);
  }

  execute(params, userCtx) {
    return this.service.execute(params, userCtx);
  }

  history(userCtx, limite) {
    return this.service.history(userCtx, limite);
  }

  tools() {
    return this.service.tools();
  }

  status() {
    return this.service.status();
  }
}

module.exports = AgentSDK;
