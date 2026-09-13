/**
 * Sprint 14.10 — Monitor de Equipamentos V1.0 (+ exports legados RC3)
 */

'use strict';

const equipmentMonitor = require('./EquipmentMonitor');
const MonitorScheduler = require('./MonitorScheduler');
const MonitorSession = require('./MonitorSession');
const MonitorEvents = require('./MonitorEvents');
const MonitorRepository = require('./MonitorRepository');
const MonitorController = require('./MonitorController');
const MonitorRoutes = require('./MonitorRoutes');

module.exports = {
  // V1.0
  equipmentMonitor,
  EquipmentMonitor: equipmentMonitor.EquipmentMonitor,
  MonitorScheduler,
  MonitorSession,
  MonitorEvents,
  MonitorRepository,
  MonitorController,
  MonitorRoutes,
  // Legado RC3 (preservado)
  monitorService: require('./MonitorService'),
  heartbeatEngine: require('./HeartbeatEngine'),
  heartbeatRepository: require('./HeartbeatRepository'),
  heartbeatStatus: require('./HeartbeatStatus'),
  heartbeatHealth: require('./HeartbeatHealth'),
  heartbeatProfile: require('./HeartbeatProfile'),
  alertChannel: require('./AlertChannel'),
  connectionMonitor: require('./ConnectionMonitor')
};
