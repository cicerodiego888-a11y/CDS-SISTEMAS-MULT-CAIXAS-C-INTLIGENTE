/**
 * Controller HTTP do CDS Monitoring Engine.
 */

const { monitoringEngine } = require('./MonitoringEngine');
const { criarMonitoringContext } = require('./MonitoringContext');

async function getSummary(req, res) {
  try {
    const context = criarMonitoringContext(req);
    const result = await monitoringEngine.summary(context);
    const status = result.success ? 200 : 207;
    return res.status(status).json({
      success: result.success,
      timestamp: result.timestamp,
      source: result.source,
      metrics: result.metrics,
      ...result.data,
      warnings: result.warnings,
      errors: result.errors
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Falha ao obter summary do Monitoring Engine',
      error: err.message || String(err)
    });
  }
}

async function getProviders(_req, res) {
  return res.json({
    success: true,
    providers: monitoringEngine.listProviders()
  });
}

module.exports = {
  getSummary,
  getProviders
};
