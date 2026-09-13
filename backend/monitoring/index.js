/**
 * CDS Monitoring Engine V1 — barrel oficial.
 */

const { MonitoringEngine, monitoringEngine, registrarProvidersPadrao } = require('./MonitoringEngine');
const { MonitoringRegistry } = require('./MonitoringRegistry');
const { criarMonitoringResult } = require('./MonitoringResult');
const { criarMonitoringContext } = require('./MonitoringContext');
const { criarMonitoringMetrics } = require('./MonitoringMetrics');
const { MonitoringCache, monitoringCache } = require('./MonitoringCache');
const { MonitoringWidgetBuilder, monitoringWidgetBuilder } = require('./widgets/MonitoringWidgetBuilder');
const { MonitoringIntelligence, monitoringIntelligence } = require('./intelligence/MonitoringIntelligence');
const {
  MonitoringActionCenter,
  monitoringActionCenter,
  MonitoringActionRegistry,
  MonitoringActionBuilder,
  criarAction,
  PRIORITY
} = require('./actions');
const router = require('./MonitoringRouter');

module.exports = {
  MonitoringEngine,
  monitoringEngine,
  registrarProvidersPadrao,
  MonitoringRegistry,
  criarMonitoringResult,
  criarMonitoringContext,
  criarMonitoringMetrics,
  MonitoringCache,
  monitoringCache,
  MonitoringWidgetBuilder,
  monitoringWidgetBuilder,
  MonitoringIntelligence,
  monitoringIntelligence,
  MonitoringActionCenter,
  monitoringActionCenter,
  MonitoringActionRegistry,
  MonitoringActionBuilder,
  criarAction,
  PRIORITY,
  router
};
