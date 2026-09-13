/**
 * Sprint 14.12 — Versão oficial Driver Toledo Prix IV Uno (homologação V2.0)
 */

'use strict';

const { DRIVER, FABRICANTE, MODELO, FIRMWARE_ALVO } = require('../ToledoProtocol');

const VERSION = Object.freeze({
  driver: DRIVER,
  driverVersion: '1.0.0',
  protocolVersion: '14.11-lab-v1-framing',
  homologacao: '14.12-V2.0',
  sprintBase: '14.1–14.11',
  fabricante: FABRICANTE,
  modelo: MODELO,
  firmwareAlvo: FIRMWARE_ALVO,
  framing: 'STX/CMD/SEP/payload/CHK/ETX',
  releasedAt: '2026-07-29'
});

function getVersion() {
  return { ...VERSION };
}

module.exports = {
  VERSION,
  getVersion
};
