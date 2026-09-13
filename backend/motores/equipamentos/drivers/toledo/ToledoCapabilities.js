/**
 * Sprint 14.4 — ToledoCapabilities
 */

'use strict';

const { DRIVER } = require('./ToledoProtocol');

const CAPABILITIES_V1 = Object.freeze({
  handshake: true,
  ping: true,
  uploadPLU: true,
  downloadPLU: true,
  syncPLU: true,
  readWeight: true,
  monitor: true,
  downloadConfig: true,
  writeConfig: true,
  writeLabel: false,
  firmwareUpdate: false,
  autoReconnect: false
});

function getCapabilities() {
  return {
    driver: DRIVER,
    capabilities: { ...CAPABILITIES_V1 }
  };
}

module.exports = {
  getCapabilities,
  CAPABILITIES_V1
};
