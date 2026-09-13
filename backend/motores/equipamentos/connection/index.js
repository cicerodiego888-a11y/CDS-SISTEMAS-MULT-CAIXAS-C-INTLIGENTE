/**
 * Sprint 14.3 / 15.1 — Connection Manager V2.0
 */

'use strict';

const connectionManager = require('./ConnectionManager');
const ConnectionFactory = require('./ConnectionFactory');
const ConnectionPool = require('./ConnectionPool');
const TcpConnection = require('./TcpConnection');
const ConnectionHealth = require('./ConnectionHealth');
const ConnectionRepository = require('./ConnectionRepository');
const ConnectionController = require('./ConnectionController');
const ConnectionRoutes = require('./ConnectionRoutes');
const ConnectionStateMachine = require('./ConnectionStateMachine');
const ConnectionEvents = require('./ConnectionEvents');
const ConnectionMetrics = require('./ConnectionMetrics');
const ConnectionHeartbeat = require('./ConnectionHeartbeat');
const EthernetTransport = require('./transports/EthernetTransport');
const SerialTransport = require('./transports/SerialTransport');
const UsbTransport = require('./transports/UsbTransport');

module.exports = {
  connectionManager,
  ConnectionManager: connectionManager.ConnectionManager,
  ConnectionFactory,
  ConnectionPool,
  TcpConnection,
  ConnectionHealth,
  ConnectionRepository,
  ConnectionController,
  ConnectionRoutes,
  ConnectionStateMachine,
  ConnectionEvents,
  ConnectionMetrics,
  ConnectionHeartbeat,
  EquipmentSession: require('./EquipmentSession').EquipmentSession,
  SESSION_STATE: require('./EquipmentSession').SESSION_STATE,
  CONNECTION_MODE: require('./EquipmentSession').CONNECTION_MODE,
  equipmentSessionRegistry: require('./EquipmentSessionRegistry'),
  EthernetTransport,
  SerialTransport,
  UsbTransport,
  STATES: require('./ConnectionStateMachine').STATES,
  EVENTS: require('./ConnectionEvents').EVENTS,
  connect: (...args) => connectionManager.connect(...args),
  disconnect: (...args) => connectionManager.disconnect(...args),
  isConnected: (...args) => connectionManager.isConnected(...args),
  reconnect: (...args) => connectionManager.reconnect(...args),
  send: (...args) => connectionManager.send(...args),
  receive: (...args) => connectionManager.receive(...args),
  ping: (...args) => connectionManager.ping(...args),
  health: (...args) => connectionManager.health(...args),
  latency: (...args) => connectionManager.latency(...args),
  getConnection: (...args) => connectionManager.getConnection(...args),
  getSessionSnapshot: (...args) => connectionManager.getSessionSnapshot(...args),
  getSession: (...args) => connectionManager.getSession(...args),
  closeAll: (...args) => connectionManager.closeAll(...args),
  listConnections: (...args) => connectionManager.listConnections(...args)
};
