/**
 * Sprint 15.7 — DriverManifest: schema e parsing do manifesto do driver.
 */

'use strict';

const { normalizarCapabilities } = require('./DriverCapabilities');

const CATEGORIAS = Object.freeze([
  'balanca',
  'impressora',
  'coletor',
  'leitor',
  'terminal',
  'outro'
]);

const TRANSPORTES = Object.freeze(['ethernet', 'serial', 'usb', 'bluetooth', 'wifi']);

/**
 * @param {Object} raw
 * @returns {Object} manifesto normalizado
 */
function parseManifest(raw = {}) {
  const id = String(raw.id || raw.codigo || '').trim();
  const fabricante = String(raw.fabricante || '').trim();
  const modelo = String(raw.modelo || '').trim();
  const categoria = String(raw.categoria || raw.tipo || 'balanca').trim().toLowerCase();
  const protocolo = String(raw.protocolo || (Array.isArray(raw.protocolos) ? raw.protocolos[0] : '') || '').trim();
  const protocolos = Array.isArray(raw.protocolos)
    ? raw.protocolos.map((p) => String(p))
    : (protocolo ? [protocolo] : []);
  const transportes = Array.isArray(raw.transportes)
    ? raw.transportes.map((t) => String(t).toLowerCase())
    : [];
  const versao = String(raw.versao || raw.version || '1.0.0');
  const prioridade = Number.isFinite(Number(raw.prioridade)) ? Number(raw.prioridade) : 100;
  const caps = normalizarCapabilities(raw.capabilities || raw.capabilitiesMap || {});

  const discovery = {
    ports: Array.isArray(raw.discovery?.ports) ? raw.discovery.ports.map(Number) : [],
    timeout: Number(raw.discovery?.timeout != null ? raw.discovery.timeout : 500),
    ...(raw.discovery && typeof raw.discovery === 'object' ? raw.discovery : {})
  };
  discovery.ports = Array.isArray(discovery.ports) ? discovery.ports.map(Number).filter((n) => n > 0) : [];

  return {
    id,
    codigo: id,
    fabricante,
    modelo,
    categoria,
    protocolo: protocolo || protocolos[0] || null,
    protocolos: protocolos.length ? protocolos : (protocolo ? [protocolo] : []),
    transportes,
    versao,
    prioridade,
    discovery,
    capabilities: caps.mapa,
    capabilitiesLista: caps.lista,
    capabilitiesAliases: caps.aliases,
    driverModule: raw.driverModule || raw.modulo || raw.module || null,
    nomeExibicao: raw.nomeExibicao || raw.nome_exibicao || `${fabricante} ${modelo}`.trim(),
    status: raw.status || 'instalado',
    motorMinimo: raw.motorMinimo || raw.versao_minima || '15.7.0',
    meta: raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {},
    raw: { ...raw }
  };
}

function isCategoriaValida(categoria) {
  return CATEGORIAS.includes(String(categoria || '').toLowerCase());
}

function isTransporteValido(transporte) {
  return TRANSPORTES.includes(String(transporte || '').toLowerCase());
}

module.exports = {
  CATEGORIAS,
  TRANSPORTES,
  parseManifest,
  isCategoriaValida,
  isTransporteValido
};
