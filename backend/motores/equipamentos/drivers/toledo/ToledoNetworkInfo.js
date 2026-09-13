/**
 * RC15.0.2 — Identidade de rede da Toledo Prix IV Uno
 * Protocolo de transporte (TCP/IP) ≠ interface física (ETHERNET | WLAN).
 */

'use strict';

const NETWORK_INTERFACE = Object.freeze({
  ETHERNET: 'ETHERNET',
  WLAN: 'WLAN',
  UNKNOWN: 'UNKNOWN'
});

const NETWORK_PROTOCOL = Object.freeze({
  TCP_IP: 'TCP/IP',
  SERIAL: 'Serial',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Normaliza valor vindo do equipamento / config.
 * Nunca assume ETHERNET para strings vazias ou "transporte CDS".
 * @param {*} raw
 * @returns {'ETHERNET'|'WLAN'|'UNKNOWN'}
 */
function normalizarInterface(raw) {
  if (raw == null) return NETWORK_INTERFACE.UNKNOWN;
  const s = String(raw).trim().toUpperCase()
    .replace(/[-\s]+/g, '_')
    .replace(/WI_FI/g, 'WIFI');

  if (!s || s === 'UNKNOWN' || s === 'DESCONHECIDO' || s === 'N_A' || s === 'NA') {
    return NETWORK_INTERFACE.UNKNOWN;
  }

  // Não tratar o transporte CDS "ethernet" (caminho TCP) como interface física
  // quando vier rotulado genericamente — só aliases explícitos de interface.
  if (
    s === 'ETHERNET'
    || s === 'ETH'
    || s === 'LAN'
    || s === 'CABO'
    || s === 'RJ45'
    || s === 'WIRED'
  ) {
    return NETWORK_INTERFACE.ETHERNET;
  }

  if (
    s === 'WLAN'
    || s === 'WIFI'
    || s === 'WIRELESS'
    || s === 'SEM_FIO'
    || s === 'WIFI_CLIENT'
  ) {
    return NETWORK_INTERFACE.WLAN;
  }

  return NETWORK_INTERFACE.UNKNOWN;
}

function rotuloInterface(codigo) {
  switch (codigo) {
    case NETWORK_INTERFACE.ETHERNET: return 'Ethernet';
    case NETWORK_INTERFACE.WLAN: return 'WLAN';
    default: return 'Não informado pelo equipamento';
  }
}

/**
 * Extrai INTERFACE de payload de configRead / parâmetros.
 * @param {*} payload
 * @returns {'ETHERNET'|'WLAN'|'UNKNOWN'}
 */
function extrairInterfaceDoPayload(payload) {
  if (payload == null) return NETWORK_INTERFACE.UNKNOWN;
  if (typeof payload === 'string' || typeof payload === 'number') {
    return normalizarInterface(payload);
  }
  if (typeof payload !== 'object') return NETWORK_INTERFACE.UNKNOWN;

  const candidatos = [
    payload.INTERFACE,
    payload.interface,
    payload.interface_rede,
    payload.network_interface,
    payload.rede_interface,
    payload.parametros?.INTERFACE,
    payload.parametros?.interface,
    payload.parametros?.interface_rede,
    payload.config?.INTERFACE,
    payload.config?.interface
  ];

  for (const c of candidatos) {
    const n = normalizarInterface(c);
    if (n !== NETWORK_INTERFACE.UNKNOWN) return n;
  }
  return NETWORK_INTERFACE.UNKNOWN;
}

/**
 * @param {{ip?:string|null, port?:number|null, interface?:string, protocol?:string, source?:string, mensagem?:string|null}} dados
 */
function montarNetwork(dados = {}) {
  const iface = normalizarInterface(dados.interface);
  const hasIp = Boolean(dados.ip);
  const protocol = dados.protocol
    || (dados.porta_com ? NETWORK_PROTOCOL.SERIAL : (hasIp ? NETWORK_PROTOCOL.TCP_IP : NETWORK_PROTOCOL.UNKNOWN));

  return {
    protocol,
    interface: iface,
    interface_label: rotuloInterface(iface),
    ip: dados.ip != null ? String(dados.ip) : null,
    port: dados.port != null && Number.isFinite(Number(dados.port)) ? Number(dados.port) : null,
    source: dados.source || (iface === NETWORK_INTERFACE.UNKNOWN ? 'unsupported' : 'unknown'),
    mensagem: iface === NETWORK_INTERFACE.UNKNOWN
      ? (dados.mensagem || 'Não informado pelo equipamento')
      : null
  };
}

module.exports = {
  NETWORK_INTERFACE,
  NETWORK_PROTOCOL,
  normalizarInterface,
  rotuloInterface,
  extrairInterfaceDoPayload,
  montarNetwork
};
