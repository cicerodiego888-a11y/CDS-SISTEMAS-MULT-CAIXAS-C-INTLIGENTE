'use strict';

/**
 * Enumeração Serial/USB para Discovery Engine (RC2).
 * Reutiliza sdkDetector (TEF) no Windows; no Linux usa /dev/tty*.
 */

const fs = require('fs');
const path = require('path');

let sdkDetector = null;
function obterSdkDetector() {
  if (!sdkDetector) {
    try {
      // eslint-disable-next-line global-require
      sdkDetector = require('../../../services/tef/sdkDetector');
    } catch (_) {
      sdkDetector = null;
    }
  }
  return sdkDetector;
}

/**
 * @returns {Array<{ porta: string, nome: string, descricao: string, origem: string }>}
 */
function listarPortasSerial() {
  if (process.platform === 'win32') {
    const sdk = obterSdkDetector();
    const lista = typeof sdk?.listarPortasCOM === 'function'
      ? sdk.listarPortasCOM()
      : [];
    return (lista || [])
      .filter((p) => p && p.porta)
      .map((p) => ({
        porta: String(p.porta),
        nome: String(p.nome || ''),
        descricao: String(p.descricao || ''),
        origem: 'win32_serialport'
      }));
  }

  // Linux / macOS
  const portas = [];
  const dir = '/dev';
  let nomes = [];
  try {
    nomes = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }

  const padroes = [/^ttyUSB\d+$/i, /^ttyS\d+$/i, /^ttyACM\d+$/i, /^cu\./i];
  for (const nome of nomes) {
    if (!padroes.some((re) => re.test(nome))) continue;
    const caminho = path.posix.join(dir, nome);
    portas.push({
      porta: caminho,
      nome,
      descricao: nome,
      origem: 'dev_tty'
    });
  }
  return portas;
}

/**
 * @returns {Array<Object>}
 */
function listarDispositivosUsb() {
  if (process.platform === 'win32') {
    const sdk = obterSdkDetector();
    if (typeof sdk?.listarDispositivosUsb === 'function') {
      return sdk.listarDispositivosUsb();
    }
    return [];
  }

  // Linux: sysfs parcial (sem libusb)
  const base = '/sys/bus/usb/devices';
  const saida = [];
  let entries = [];
  try {
    entries = fs.readdirSync(base);
  } catch (_) {
    return [];
  }

  for (const id of entries) {
    const pasta = path.join(base, id);
    try {
      const vidPath = path.join(pasta, 'idVendor');
      const pidPath = path.join(pasta, 'idProduct');
      if (!fs.existsSync(vidPath) || !fs.existsSync(pidPath)) continue;
      const vid = fs.readFileSync(vidPath, 'utf8').trim().toUpperCase().padStart(4, '0');
      const pid = fs.readFileSync(pidPath, 'utf8').trim().toUpperCase().padStart(4, '0');
      let manufacturer = '';
      let product = '';
      let serial = '';
      try { manufacturer = fs.readFileSync(path.join(pasta, 'manufacturer'), 'utf8').trim(); } catch (_) { /* */ }
      try { product = fs.readFileSync(path.join(pasta, 'product'), 'utf8').trim(); } catch (_) { /* */ }
      try { serial = fs.readFileSync(path.join(pasta, 'serial'), 'utf8').trim(); } catch (_) { /* */ }
      saida.push({
        nome: product || `${vid}:${pid}`,
        caminho_dispositivo: pasta,
        manufacturer,
        product,
        status: 'present',
        classe: 'usb',
        vid,
        pid,
        serial_number: serial || null
      });
    } catch (_) {
      // ignore device
    }
  }
  return saida;
}

module.exports = {
  listarPortasSerial,
  listarDispositivosUsb
};
