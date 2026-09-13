/**
 * Barrel — COP Action Center (Sprint M4)
 */

const { MonitoringActionCenter, monitoringActionCenter } = require('./MonitoringActionCenter');
const { MonitoringActionRegistry } = require('./MonitoringActionRegistry');
const { MonitoringActionBuilder, registrarCatalogoPadrao } = require('./MonitoringActionBuilder');
const { criarAction, criarActionResult, PRIORITY } = require('./MonitoringActionResult');
const { criarActionContext } = require('./MonitoringActionContext');
const { filtrarActionsPorPermissao, temPermissao, PAGE_PERMISSION } = require('./MonitoringActionPermissions');

module.exports = {
  MonitoringActionCenter,
  monitoringActionCenter,
  MonitoringActionRegistry,
  MonitoringActionBuilder,
  registrarCatalogoPadrao,
  criarAction,
  criarActionResult,
  PRIORITY,
  criarActionContext,
  filtrarActionsPorPermissao,
  temPermissao,
  PAGE_PERMISSION
};
