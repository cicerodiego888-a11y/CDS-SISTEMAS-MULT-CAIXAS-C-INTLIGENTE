/**
 * Sprint 15.1 — ConnectionFactory V2
 * Instancia o transporte correto (Ethernet / Serial / USB).
 */

'use strict';

const EthernetTransport = require('./transports/EthernetTransport');
const SerialTransport = require('./transports/SerialTransport');
const UsbTransport = require('./transports/UsbTransport');
const TcpConnection = require('./TcpConnection');

const TRANSPORTES = Object.freeze({
  TCP: 'TCP',
  ETHERNET: 'ETHERNET',
  UDP: 'UDP',
  SERIAL: 'SERIAL',
  USB: 'USB',
  BLUETOOTH: 'BLUETOOTH'
});

function normalizarTransporte(valor) {
  const t = String(valor || 'ethernet').toUpperCase();
  if (t === 'TCP' || t === 'ETHERNET' || t === 'ETH') return TRANSPORTES.ETHERNET;
  if (t === 'SERIAL' || t === 'COM') return TRANSPORTES.SERIAL;
  if (t === 'USB') return TRANSPORTES.USB;
  return t;
}

class ConnectionFactory {
  /**
   * @param {{transporte?:string, host?:string, porta?:number, timeoutMs?:number, porta_com?:string, vid?:string, pid?:string}} opcoes
   * @returns {object} transporte com connect/disconnect/send/receive/ping/destroy
   */
  create(opcoes = {}) {
    const transporte = normalizarTransporte(opcoes.transporte);

    if (transporte === TRANSPORTES.ETHERNET || transporte === TRANSPORTES.TCP) {
      return new EthernetTransport({
        host: opcoes.host || opcoes.ip,
        porta: opcoes.porta || opcoes.porta_tcp,
        timeoutMs: opcoes.timeoutMs
      });
    }

    if (transporte === TRANSPORTES.SERIAL) {
      return new SerialTransport({
        porta_com: opcoes.porta_com || opcoes.path || opcoes.host,
        baudRate: opcoes.baudRate,
        timeoutMs: opcoes.timeoutMs
      });
    }

    if (transporte === TRANSPORTES.USB) {
      return new UsbTransport({
        vid: opcoes.vid,
        pid: opcoes.pid,
        caminho_dispositivo: opcoes.caminho_dispositivo || opcoes.path,
        timeoutMs: opcoes.timeoutMs
      });
    }

    const err = new Error(`Transporte não suportado: ${transporte}`);
    err.code = 'TRANSPORT_NAO_SUPORTADO';
    err.statusCode = 501;
    throw err;
  }

  /**
   * Compat V1: cria TcpConnection direto (Drivers que usam getTcp).
   */
  createTcp(opcoes = {}) {
    return new TcpConnection({
      host: opcoes.host,
      porta: opcoes.porta,
      timeoutMs: opcoes.timeoutMs
    });
  }

  /**
   * @param {object} driver — instância ou meta com transportes / discovery
   */
  createConnection(driver = {}, extras = {}) {
    const info = typeof driver.informacoes === 'function' ? driver.informacoes() : (driver || {});
    const transportes = info.transportes || driver.transportes || [];
    const discovery = driver.constructor?.discovery || driver.discovery || {};
    let transporte = extras.transporte
      || discovery.transport
      || (Array.isArray(transportes) && transportes[0])
      || 'ethernet';

    return this.create({
      transporte,
      host: extras.host || extras.ip || driver.host || driver.ip,
      porta: extras.porta || extras.porta_tcp || driver.porta || driver.porta_tcp
        || (Array.isArray(discovery.ports) ? discovery.ports[0] : undefined),
      porta_com: extras.porta_com || driver.porta_com,
      vid: extras.vid || driver.vid,
      pid: extras.pid || driver.pid,
      timeoutMs: extras.timeoutMs || discovery.timeout,
      ...extras
    });
  }

  listarTransportesFuturos() {
    return Object.values(TRANSPORTES);
  }

  listarTransportesSuportados() {
    return [TRANSPORTES.ETHERNET, TRANSPORTES.TCP, TRANSPORTES.SERIAL, TRANSPORTES.USB];
  }
}

module.exports = ConnectionFactory;
module.exports.ConnectionFactory = ConnectionFactory;
module.exports.TRANSPORTES = TRANSPORTES;
module.exports.normalizarTransporte = normalizarTransporte;
