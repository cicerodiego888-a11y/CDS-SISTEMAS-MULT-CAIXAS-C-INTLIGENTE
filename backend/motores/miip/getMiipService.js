'use strict';

/**
 * RC11.5 — Accessor lazy do MiipService.
 *
 * Garante que MiipService (e engines) só sejam carregados no primeiro uso,
 * reutilizando o singleton exportado pelo módulo nas chamadas seguintes.
 *
 * Não altera regras de negócio, Decision/Explain/Synonyms/Canonical engines.
 *
 * @module motores/miip/getMiipService
 */

const { getLazySingleton } = require('../../boot/lazyService');

/**
 * @returns {import('./MiipService')}
 */
function getMiipService() {
  return getLazySingleton('MiipService', () => require('./MiipService'));
}

module.exports = { getMiipService };
