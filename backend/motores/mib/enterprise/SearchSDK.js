'use strict';

/**
 * SearchSDK — biblioteca interna server-side (MIB-RC3.0).
 * Uso: SearchSDK.search({ entity, query })
 */
class SearchSDK {
  /**
   * @param {import('./SearchService')} service
   */
  constructor(service) {
    this.service = service;
  }

  static fromDb(db) {
    const SearchService = require('./SearchService');
    const MibService = require('../MibService');
    const mib = MibService.getInstance(db);
    const svc = SearchService.getInstance(db, mib);
    return new SearchSDK(svc);
  }

  search(params) {
    return this.service.search(params);
  }

  learn(payload) {
    return this.service.learn(payload);
  }

  rebuild() {
    return this.service.rebuild();
  }

  statistics() {
    return this.service.statistics();
  }

  providers() {
    return this.service.listarProviders();
  }

  benchmark(entities) {
    return this.service.benchmark.executar(entities);
  }

  dashboard() {
    return this.service.enterpriseDashboard();
  }
}

module.exports = SearchSDK;
