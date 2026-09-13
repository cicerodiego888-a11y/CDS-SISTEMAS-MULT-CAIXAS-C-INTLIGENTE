'use strict';

/**
 * Utilitários de rede para Discovery Ethernet (RC1 / RC1.1 hardening).
 */

const os = require('os');
const net = require('net');

const NOMES_VIRTUAIS = [
  /loopback/i,
  /^lo\d*$/i,
  /docker/i,
  /veth/i,
  /br-/i,
  /virbr/i,
  /vmware/i,
  /virtualbox/i,
  /vbox/i,
  /hyper-?v/i,
  /vethernet/i,
  /wsl/i,
  /vpn/i,
  /tun\d*/i,
  /tap\d*/i,
  /tailscale/i,
  /zerotier/i,
  /hamachi/i
];

/** Limites de concorrência (RC1.1) */
const CONCORRENCIA_MIN = 1;
const CONCORRENCIA_MAX = 64;
const CONCORRENCIA_PADRAO = 32;

/** Contadores de sockets do probeTcp — auditoria de vazamento */
const probeStats = {
  abertos: 0,
  pico: 0,
  total_criados: 0,
  total_fechados: 0
};

function resetProbeStats() {
  probeStats.abertos = 0;
  probeStats.pico = 0;
  probeStats.total_criados = 0;
  probeStats.total_fechados = 0;
}

function getProbeStats() {
  return { ...probeStats };
}

function clamparConcorrencia(valor, padrao = CONCORRENCIA_PADRAO) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(CONCORRENCIA_MIN, Math.min(CONCORRENCIA_MAX, Math.floor(n)));
}

function ipv4ParaInt(ip) {
  return ip.split('.').reduce((acc, oct) => ((acc << 8) + (Number(oct) & 255)) >>> 0, 0);
}

function intParaIpv4(n) {
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255
  ].join('.');
}

function mascaraCidr(bits) {
  if (bits <= 0) return 0;
  if (bits >= 32) return 0xffffffff;
  return (0xffffffff << (32 - bits)) >>> 0;
}

function cidrDeMascara(mascara) {
  const n = ipv4ParaInt(mascara);
  let bits = 0;
  for (let i = 31; i >= 0; i -= 1) {
    if ((n >>> i) & 1) bits += 1;
    else break;
  }
  return bits;
}

function parseCidr(cidr) {
  const texto = String(cidr || '').trim();
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(texto);
  if (!m) return null;
  const ip = m[1];
  const bits = Number(m[2]);
  if (!net.isIPv4(ip) || bits < 0 || bits > 32) return null;
  // Octetos 0–255
  const octetos = ip.split('.').map(Number);
  if (octetos.some((o) => o < 0 || o > 255)) return null;
  const ipInt = ipv4ParaInt(ip);
  const mask = mascaraCidr(bits);
  const network = (ipInt & mask) >>> 0;
  return { ip, bits, network, mask, broadcast: (network | (~mask >>> 0)) >>> 0 };
}

function interfaceEhVirtual(nome) {
  const n = String(nome || '');
  return NOMES_VIRTUAIS.some((re) => re.test(n));
}

/**
 * Detecta subnets IPv4 utilizáveis nas interfaces locais.
 * @returns {Array<{ nome, endereco, mascara, cidr, bits }>}
 */
function listarSubnetsLocais() {
  const ifaces = os.networkInterfaces();
  const saida = [];

  for (const [nome, lista] of Object.entries(ifaces || {})) {
    if (interfaceEhVirtual(nome)) continue;
    for (const info of lista || []) {
      if (!info || info.internal) continue;
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (!net.isIPv4(info.address)) continue;
      if (String(info.address).startsWith('169.254.')) continue;
      const bits = info.cidr
        ? Number(String(info.cidr).split('/')[1])
        : cidrDeMascara(info.netmask || '255.255.255.0');
      const cidr = info.cidr || `${info.address}/${bits}`;
      saida.push({
        nome,
        endereco: info.address,
        mascara: info.netmask,
        cidr,
        bits
      });
    }
  }

  return saida;
}

/**
 * Expande CIDR em lista de hosts (sem network/broadcast). Caps em maxHosts.
 * /24,/25,/26,/27 respeitam a máscara; < /24 limita a /24 do endereço.
 * @param {string} cidr
 * @param {number} [maxHosts=254]
 * @returns {string[]}
 */
function expandirHostsCidr(cidr, maxHosts = 254) {
  const parsed = parseCidr(cidr);
  if (!parsed) return [];

  let bits = parsed.bits;
  let network = parsed.network;
  let broadcast = parsed.broadcast;

  if (bits < 24) {
    const ipInt = ipv4ParaInt(parsed.ip);
    const mask24 = mascaraCidr(24);
    network = (ipInt & mask24) >>> 0;
    broadcast = (network | (~mask24 >>> 0)) >>> 0;
    bits = 24;
  }

  // /31 e /32: sem faixa clássica de hosts — retorna o próprio IP se útil
  if (bits >= 31) {
    return [parsed.ip].slice(0, maxHosts);
  }

  const hosts = [];
  const primeiro = network + 1;
  const ultimo = broadcast - 1;
  const limite = Math.max(1, Number(maxHosts) || 254);
  for (let n = primeiro; n <= ultimo; n += 1) {
    hosts.push(intParaIpv4(n >>> 0));
    if (hosts.length >= limite) break;
  }
  return hosts;
}

/**
 * Contagem teórica de hosts para auditoria de performance.
 * @param {string} cidr
 * @returns {number}
 */
function contarHostsCidr(cidr) {
  return expandirHostsCidr(cidr, Number.MAX_SAFE_INTEGER).length;
}

/**
 * Probe TCP curto: connect → timeout → destroy. Sem reconnect.
 * @param {string} host
 * @param {number} porta
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, latencia_ms: number, erro?: string }>}
 */
function probeTcp(host, porta, timeoutMs = 800) {
  const inicio = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finalizado = false;

    probeStats.total_criados += 1;
    probeStats.abertos += 1;
    if (probeStats.abertos > probeStats.pico) probeStats.pico = probeStats.abertos;

    const concluir = (ok, erro) => {
      if (finalizado) return;
      finalizado = true;
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      probeStats.abertos = Math.max(0, probeStats.abertos - 1);
      probeStats.total_fechados += 1;
      resolve({
        ok,
        latencia_ms: Date.now() - inicio,
        erro: erro || undefined
      });
    };

    socket.setTimeout(Math.max(50, Number(timeoutMs) || 800));
    socket.once('connect', () => concluir(true));
    socket.once('timeout', () => concluir(false, 'timeout'));
    socket.once('error', (err) => concluir(false, err.message));
    try {
      socket.connect(Number(porta), String(host));
    } catch (err) {
      concluir(false, err.message);
    }
  });
}

/**
 * Executa fn sobre itens com limite de concorrência.
 * Nunca deixa worker rejeitar a Promise do pool (isola erros).
 * @template T,R
 * @param {T[]} itens
 * @param {number} concorrencia
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {{ cancelado?: () => boolean, onInFlight?: (n: number) => void }} [opts]
 * @returns {Promise<R[]>}
 */
async function mapPool(itens, concorrencia, worker, opts = {}) {
  const limite = clamparConcorrencia(concorrencia);
  const resultados = new Array(itens.length);
  let indice = 0;
  let inFlight = 0;
  let picoInFlight = 0;

  async function correr() {
    while (indice < itens.length) {
      if (opts.cancelado && opts.cancelado()) break;
      const atual = indice;
      indice += 1;
      inFlight += 1;
      if (inFlight > picoInFlight) picoInFlight = inFlight;
      if (typeof opts.onInFlight === 'function') opts.onInFlight(inFlight);
      try {
        resultados[atual] = await worker(itens[atual], atual);
      } catch (_) {
        resultados[atual] = null;
      } finally {
        inFlight -= 1;
        if (typeof opts.onInFlight === 'function') opts.onInFlight(inFlight);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limite, itens.length); i += 1) {
    workers.push(correr());
  }
  await Promise.all(workers);
  mapPool._ultimoPicoInFlight = picoInFlight;
  return resultados;
}

mapPool._ultimoPicoInFlight = 0;

module.exports = {
  CONCORRENCIA_MIN,
  CONCORRENCIA_MAX,
  CONCORRENCIA_PADRAO,
  listarSubnetsLocais,
  expandirHostsCidr,
  contarHostsCidr,
  parseCidr,
  probeTcp,
  mapPool,
  interfaceEhVirtual,
  ipv4ParaInt,
  intParaIpv4,
  clamparConcorrencia,
  resetProbeStats,
  getProbeStats
};
