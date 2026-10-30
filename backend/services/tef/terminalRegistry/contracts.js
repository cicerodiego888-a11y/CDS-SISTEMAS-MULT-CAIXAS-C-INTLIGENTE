'use strict';

/**
 * MRT-03 — Contrato do CDS TEF Terminal Registry.
 *
 * Persistência oficial NÃO é aplicada nesta sprint.
 * Store em memória / injeção para testes; migration proposta em docs/build.
 */

const TERMINAL_STATES = Object.freeze({
  ATIVO: 'ATIVO',
  INATIVO: 'INATIVO',
  INDISPONIVEL: 'INDISPONIVEL',
  NAO_PROVISIONADO: 'NAO_PROVISIONADO'
});

const REGISTRY_CODES = Object.freeze({
  REGISTRY_HIT: 'REGISTRY_HIT',
  REGISTRY_MISS: 'REGISTRY_MISS',
  TERMINAL_INATIVO: 'TERMINAL_INATIVO',
  TERMINAL_INDISPONIVEL: 'TERMINAL_INDISPONIVEL',
  TERMINAL_NAO_PROVISIONADO: 'TERMINAL_NAO_PROVISIONADO',
  TERMINAL_AMBIGUO: 'TERMINAL_AMBIGUO',
  EMPRESA_LOJA_INCOMPATIVEL: 'EMPRESA_LOJA_INCOMPATIVEL',
  DISPOSITIVO_AUSENTE: 'DISPOSITIVO_AUSENTE',
  REGISTRY_ERRO: 'REGISTRY_ERRO'
});

/**
 * @typedef {object} DispositivoFisico
 * @property {string} id
 * @property {'pinpad'|'pinpad_ip'|'virtual'|string} tipo
 * @property {string|null} [portaCom]
 * @property {string|null} [ip]
 * @property {number|null} [porta]
 * @property {string|null} [serial]
 * @property {string|null} [fabricante]
 * @property {string|null} [modelo]
 * @property {boolean} [ativo]
 */

/**
 * @typedef {object} TerminalTef
 * @property {string} id
 * @property {string} pdvId - terminais.id CDS
 * @property {string|null} [empresaId]
 * @property {string|null} [lojaId]
 * @property {string} provedor - destaxa|sitef|paygo|…
 * @property {string} ambiente
 * @property {string|null} [codigoLogicoProvedor] - ex. terminal_codigo Destaxa (≠ PinPad)
 * @property {string} estado - TERMINAL_STATES
 * @property {DispositivoFisico|null} [dispositivo]
 * @property {object} [adapterRegistro] - fragmento compatível com tefFactory
 * @property {string[]} [provedoresAlternativos]
 */

function normalizarEstado(estado) {
  const e = String(estado || '').trim().toUpperCase();
  if (Object.values(TERMINAL_STATES).includes(e)) return e;
  return TERMINAL_STATES.NAO_PROVISIONADO;
}

function criarDispositivo(parcial = {}) {
  if (!parcial || !parcial.id) return null;
  return {
    id: String(parcial.id),
    tipo: String(parcial.tipo || 'pinpad'),
    portaCom: parcial.portaCom != null ? String(parcial.portaCom) : (parcial.porta_com || null),
    ip: parcial.ip != null ? String(parcial.ip) : null,
    porta: parcial.porta != null ? Number(parcial.porta) : null,
    serial: parcial.serial != null ? String(parcial.serial) : null,
    fabricante: parcial.fabricante || null,
    modelo: parcial.modelo || null,
    ativo: parcial.ativo !== false,
    // Nunca confundir com pdvId / hostname
    identidadeEhHostname: false,
    identidadeEhPdv: false
  };
}

function criarTerminalTef(parcial = {}) {
  const id = parcial.id != null ? String(parcial.id) : null;
  const pdvId = parcial.pdvId != null ? String(parcial.pdvId) : null;
  return {
    id,
    pdvId,
    empresaId: parcial.empresaId != null ? String(parcial.empresaId) : null,
    lojaId: parcial.lojaId != null ? String(parcial.lojaId) : null,
    provedor: String(parcial.provedor || '').toLowerCase() || null,
    ambiente: String(parcial.ambiente || 'simulacao').toLowerCase(),
    codigoLogicoProvedor: parcial.codigoLogicoProvedor != null
      ? String(parcial.codigoLogicoProvedor)
      : (parcial.terminal_codigo || null),
    estado: normalizarEstado(parcial.estado || TERMINAL_STATES.NAO_PROVISIONADO),
    dispositivo: criarDispositivo(parcial.dispositivo),
    adapterRegistro: parcial.adapterRegistro || null,
    provedoresAlternativos: Array.isArray(parcial.provedoresAlternativos)
      ? parcial.provedoresAlternativos.map((p) => String(p).toLowerCase())
      : [],
    meta: parcial.meta || null
  };
}

module.exports = {
  TERMINAL_STATES,
  REGISTRY_CODES,
  normalizarEstado,
  criarDispositivo,
  criarTerminalTef
};
