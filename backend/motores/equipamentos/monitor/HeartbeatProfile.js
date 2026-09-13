'use strict';

/**
 * Perfil de Heartbeat por transporte / driver — RC3.1
 * Drivers podem informar via `informacoes().heartbeat` ou `heartbeatPerfil`.
 * Não altera DriverRegistry / DriverManager.
 */

const TIPO_TESTE = Object.freeze({
  TCP_CONNECT: 'TCP_CONNECT',
  HANDSHAKE: 'HANDSHAKE',
  PING_LOGICO: 'PING_LOGICO',
  LEITURA_SIMPLES: 'LEITURA_SIMPLES'
});

const DEFAULTS_TRANSPORTE = Object.freeze({
  ethernet: {
    intervalo_ms: Number(process.env.EQUIPAMENTOS_HB_INTERVAL_ETHERNET_MS || 30000),
    timeout_ms: Number(process.env.EQUIPAMENTOS_HB_TIMEOUT_ETHERNET_MS || 3000),
    tipo_teste: TIPO_TESTE.TCP_CONNECT
  },
  serial: {
    intervalo_ms: Number(process.env.EQUIPAMENTOS_HB_INTERVAL_SERIAL_MS || 60000),
    timeout_ms: Number(process.env.EQUIPAMENTOS_HB_TIMEOUT_SERIAL_MS || 2000),
    tipo_teste: TIPO_TESTE.HANDSHAKE
  },
  usb: {
    intervalo_ms: Number(process.env.EQUIPAMENTOS_HB_INTERVAL_USB_MS || 60000),
    timeout_ms: Number(process.env.EQUIPAMENTOS_HB_TIMEOUT_USB_MS || 2000),
    tipo_teste: TIPO_TESTE.PING_LOGICO
  }
});

/**
 * @param {Object} equipamento
 * @param {Object|null} [driverInstance]
 * @returns {{ intervalo_ms: number, timeout_ms: number, tipo_teste: string, origem: string }}
 */
function obterPerfilHeartbeat(equipamento = {}, driverInstance = null) {
  const transporte = String(equipamento.transporte || 'ethernet').toLowerCase();
  const base = { ...(DEFAULTS_TRANSPORTE[transporte] || DEFAULTS_TRANSPORTE.ethernet) };

  let origem = `transporte:${transporte}`;

  const fromDriver =
    (driverInstance && typeof driverInstance.heartbeatPerfil === 'function'
      ? driverInstance.heartbeatPerfil()
      : null)
    || (driverInstance && typeof driverInstance.informacoes === 'function'
      ? (driverInstance.informacoes() || {}).heartbeat
      : null)
    || null;

  if (fromDriver && typeof fromDriver === 'object') {
    if (Number(fromDriver.intervalo_ms) > 0) base.intervalo_ms = Number(fromDriver.intervalo_ms);
    if (Number(fromDriver.timeout_ms) > 0) base.timeout_ms = Number(fromDriver.timeout_ms);
    if (fromDriver.tipo_teste) base.tipo_teste = String(fromDriver.tipo_teste);
    origem = 'driver';
  }

  if (Number(equipamento.timeout_ms) > 0 && origem.startsWith('transporte')) {
    base.timeout_ms = Math.min(base.timeout_ms, Number(equipamento.timeout_ms));
  }

  base.intervalo_ms = Math.max(5000, Number(base.intervalo_ms) || 30000);
  base.timeout_ms = Math.max(500, Number(base.timeout_ms) || 3000);
  base.origem = origem;
  return base;
}

module.exports = {
  TIPO_TESTE,
  DEFAULTS_TRANSPORTE,
  obterPerfilHeartbeat
};
