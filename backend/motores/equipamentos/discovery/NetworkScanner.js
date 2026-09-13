/**
 * Sprint 14.1 / 15.0 — NetworkScanner
 * Descobre interfaces de rede locais e calcula sub-redes automaticamente.
 */

'use strict';

const os = require('os');
const net = require('net');
const { execSync } = require('child_process');

const NOMES_VIRTUAIS = [
  /loopback/i, /^lo\d*$/i, /docker/i, /veth/i, /br-/i, /virbr/i,
  /vmware/i, /virtualbox/i, /vbox/i, /hyper-?v/i, /vethernet/i,
  /wsl/i, /vpn/i, /tun\d*/i, /tap\d*/i, /tailscale/i, /zerotier/i, /hamachi/i
];

function ipv4ParaInt(ip) {
  return String(ip).split('.').reduce((acc, oct) => ((acc << 8) + (Number(oct) & 255)) >>> 0, 0);
}

function intParaIpv4(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
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

function mascaraCidr(bits) {
  if (bits <= 0) return 0;
  if (bits >= 32) return 0xffffffff;
  return (0xffffffff << (32 - bits)) >>> 0;
}

function interfaceEhVirtual(nome) {
  return NOMES_VIRTUAIS.some((re) => re.test(String(nome || '')));
}

function tentarGatewayWindows() {
  try {
    const out = execSync('route print -4', { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const linhas = String(out).split(/\r?\n/);
    for (const linha of linhas) {
      const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/.exec(linha);
      if (m) return m[1];
    }
  } catch (_) { /* ignore */ }
  return null;
}

function montarSubRede(iface, { maxHosts = 254, clamparBits = true } = {}) {
  let bits = Number(iface.bits) || 24;
  const ipInt = ipv4ParaInt(iface.endereco);
  if (clamparBits && bits < 24) bits = 24;
  const mask = mascaraCidr(bits);
  const network = (ipInt & mask) >>> 0;
  const broadcastInt = (network | (~mask >>> 0)) >>> 0;
  const subnet = `${intParaIpv4(network)}/${bits}`;
  const broadcast = intParaIpv4(broadcastInt);

  const hosts = [];
  const primeiro = network + 1;
  const ultimo = broadcastInt - 1;
  for (let h = primeiro; h <= ultimo && hosts.length < maxHosts; h += 1) {
    const ip = intParaIpv4(h);
    if (ip === iface.endereco) continue;
    hosts.push(ip);
  }

  return {
    ip: iface.endereco,
    subnet,
    broadcast,
    nome: iface.nome,
    mascara: iface.mascara,
    bits,
    hosts,
    totalHosts: hosts.length,
    faixaInicio: hosts[0] || null,
    faixaFim: hosts[hosts.length - 1] || null
  };
}

class NetworkScanner {
  /**
   * Lista interfaces IPv4 ativas (não virtuais / não link-local).
   * @returns {Array<{nome, endereco, mascara, cidr, bits}>}
   */
  listarInterfaces() {
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
        saida.push({
          nome,
          endereco: info.address,
          mascara: info.netmask,
          cidr: info.cidr || `${info.address}/${bits}`,
          bits
        });
      }
    }
    return saida;
  }

  /**
   * Sprint 15.0 — lista sub-redes detectadas automaticamente.
   * Formato: [{ ip, subnet, broadcast }]
   * @returns {Array<{ip:string, subnet:string, broadcast:string, nome?:string, mascara?:string}>}
   */
  listarSubRedes({ maxHosts = 254 } = {}) {
    return this.listarInterfaces().map((iface) => {
      const sub = montarSubRede(iface, { maxHosts });
      return {
        ip: sub.ip,
        subnet: sub.subnet,
        broadcast: sub.broadcast,
        nome: sub.nome,
        mascara: sub.mascara,
        bits: sub.bits,
        hosts: sub.hosts,
        totalHosts: sub.totalHosts,
        faixaInicio: sub.faixaInicio,
        faixaFim: sub.faixaFim
      };
    });
  }

  /**
   * Escolhe a melhor interface e monta o contexto de rede.
   * @returns {{interface, ipLocal, mascara, gateway, cidr, faixaInicio, faixaFim, hosts, broadcast}}
   */
  descobrirRede({ maxHosts = 254 } = {}) {
    const interfaces = this.listarInterfaces();
    if (!interfaces.length) {
      const err = new Error('Nenhuma interface de rede IPv4 ativa encontrada.');
      err.code = 'INTERFACE_NAO_ENCONTRADA';
      err.statusCode = 400;
      throw err;
    }

    const preferida = interfaces.find((i) => i.bits < 32 && i.bits >= 24)
      || interfaces.find((i) => i.bits < 32)
      || interfaces[0];

    const sub = montarSubRede(preferida, { maxHosts });
    const gateway = tentarGatewayWindows()
      || (sub.hosts[0] || null);

    return {
      interface: preferida.nome,
      ipLocal: preferida.endereco,
      mascara: preferida.mascara,
      gateway,
      cidr: sub.subnet,
      broadcast: sub.broadcast,
      faixaInicio: sub.faixaInicio,
      faixaFim: sub.faixaFim,
      hosts: sub.hosts,
      totalHosts: sub.totalHosts,
      subRedes: this.listarSubRedes({ maxHosts })
    };
  }
}

module.exports = NetworkScanner;
module.exports.NetworkScanner = NetworkScanner;
module.exports.ipv4ParaInt = ipv4ParaInt;
module.exports.intParaIpv4 = intParaIpv4;
