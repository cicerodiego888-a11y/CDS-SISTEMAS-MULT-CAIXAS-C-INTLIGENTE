/**
 * RC14.14.2 — Tabela oficial de comandos Toledo Prix IV Uno (90AX)
 * Uma semântica por wireCommand no fluxo de produção.
 *
 * DP = DOWNLOAD_PLU (único). Departamento usa UD.
 */

'use strict';

const ToledoTimeouts = require('../ToledoTimeouts');

/**
 * @typedef {object} OfficialCommand
 * @property {string} name
 * @property {string} wire
 * @property {string} describe
 * @property {boolean} oficial
 */

const OFFICIAL = Object.freeze({
  HANDSHAKE: Object.freeze({ name: 'handshake', wire: 'HS', describe: 'Handshake / identify', oficial: true }),
  IDENTIFY: Object.freeze({ name: 'identify', wire: 'HS', describe: 'Identificação (alias HS)', oficial: true }),
  PING: Object.freeze({ name: 'ping', wire: 'PN', describe: 'Ping', oficial: true }),
  KEEP_ALIVE: Object.freeze({ name: 'keepAlive', wire: 'PN', describe: 'Keep-alive (mesmo fio PN)', oficial: true }),
  STATUS: Object.freeze({ name: 'status', wire: 'ST', describe: 'Status', oficial: true }),
  UPLOAD_PLU: Object.freeze({ name: 'uploadPlu', wire: 'EP', describe: 'Upload PLU', oficial: true }),
  UPLOAD_PRICE: Object.freeze({ name: 'uploadPrice', wire: 'EP', describe: 'Upload preço (payload tipo=preco)', oficial: true }),
  UPLOAD_LABEL: Object.freeze({ name: 'uploadLabel', wire: 'EP', describe: 'Upload etiqueta (payload tipo=etiqueta)', oficial: true }),
  DOWNLOAD_PLU: Object.freeze({ name: 'downloadPlu', wire: 'DP', describe: 'Download PLU — único dono de DP', oficial: true }),
  UPLOAD_DEPARTMENT: Object.freeze({ name: 'uploadDepartment', wire: 'UD', describe: 'Upload departamento (não usa DP)', oficial: true }),
  READ_WEIGHT: Object.freeze({ name: 'readWeight', wire: 'PW', describe: 'Leitura de peso', oficial: true }),
  CONFIG_READ: Object.freeze({ name: 'configRead', wire: 'CR', describe: 'Leitura de configuração', oficial: true }),
  CONFIG_WRITE: Object.freeze({ name: 'configWrite', wire: 'CW', describe: 'Escrita de configuração', oficial: true })
});

/** Wire → names oficiais (detecção de colisão) */
function indexByWire() {
  const map = new Map();
  for (const def of Object.values(OFFICIAL)) {
    if (!map.has(def.wire)) map.set(def.wire, []);
    map.get(def.wire).push(def.name);
  }
  return map;
}

/**
 * Valida que nenhum wire tenha duas semânticas conflitantes
 * (aliases HS/PN/EP no mesmo fio são permitidos se documentados).
 */
function validarSemColisao() {
  const byWire = indexByWire();
  const colisoes = [];
  // DP deve ter exatamente um name: downloadPlu
  const dp = byWire.get('DP') || [];
  if (dp.length !== 1 || dp[0] !== 'downloadPlu') {
    colisoes.push({ wire: 'DP', names: dp, regra: 'DP exclusivo de downloadPlu' });
  }
  // UD não pode ser DP
  const dept = OFFICIAL.UPLOAD_DEPARTMENT;
  if (dept.wire === 'DP') {
    colisoes.push({ wire: 'DP', names: [dept.name], regra: 'departamento não pode usar DP' });
  }
  return { ok: colisoes.length === 0, colisoes, byWire: Object.fromEntries(byWire) };
}

const TIMEOUT_PADRAO = Object.freeze({
  handshake: ToledoTimeouts.HANDSHAKE,
  identify: ToledoTimeouts.HANDSHAKE,
  ping: ToledoTimeouts.READ,
  keepAlive: ToledoTimeouts.READ,
  status: ToledoTimeouts.READ,
  uploadPlu: ToledoTimeouts.WRITE,
  uploadPrice: ToledoTimeouts.WRITE,
  uploadLabel: ToledoTimeouts.WRITE,
  downloadPlu: ToledoTimeouts.READ,
  uploadDepartment: ToledoTimeouts.WRITE,
  readWeight: ToledoTimeouts.READ,
  configRead: ToledoTimeouts.READ,
  configWrite: ToledoTimeouts.WRITE
});

function listar() {
  return Object.values(OFFICIAL).map((c) => ({ ...c }));
}

function obterPorNome(name) {
  const key = String(name || '').toLowerCase();
  return listar().find((c) => c.name.toLowerCase() === key) || null;
}

function wireDe(name) {
  return obterPorNome(name)?.wire || null;
}

module.exports = {
  OFFICIAL,
  TIMEOUT_PADRAO,
  listar,
  obterPorNome,
  wireDe,
  validarSemColisao,
  indexByWire
};
