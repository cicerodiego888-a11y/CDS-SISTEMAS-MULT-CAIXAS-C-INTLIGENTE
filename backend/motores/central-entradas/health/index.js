/**
 * Health Monitor da Central de Entradas (RC3.4.6).
 *
 * Somente diagnóstico local (banco / MIRX state / status).
 * Não consulta SEFAZ. Não altera MIRX, MIIP nem Plataforma Fiscal.
 *
 * @module motores/central-entradas/health
 */

const scheduler = require('./HealthScheduler');
const HealthMonitor = require('./HealthMonitor');
const HealthAnalyzer = require('./HealthAnalyzer');
const HealthRules = require('./HealthRules');
const HealthRepository = require('./HealthRepository');
const HealthNotifier = require('./HealthNotifier');
const HealthNiveis = require('./HealthNiveis');

module.exports = scheduler;
module.exports.HealthScheduler = scheduler.HealthScheduler;
module.exports.HealthMonitor = HealthMonitor;
module.exports.HealthAnalyzer = HealthAnalyzer;
module.exports.HealthRules = HealthRules;
module.exports.HealthRepository = HealthRepository;
module.exports.HealthNotifier = HealthNotifier;
module.exports.HealthNiveis = HealthNiveis.HealthNiveis;
module.exports.obterLabelNivel = HealthNiveis.obterLabel;
module.exports.TIPOS_HEALTH = HealthNotifier.TIPOS_HEALTH;
