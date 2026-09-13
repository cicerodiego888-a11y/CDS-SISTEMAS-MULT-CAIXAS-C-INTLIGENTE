/**
 * Sprint 14.11 — ToledoConfigurationProfile
 * Metadados de parâmetros suportados (modelo + firmware).
 */

'use strict';

const { MODELO, FIRMWARE_ALVO, DRIVER } = require('../ToledoProtocol');

/**
 * Parâmetros efetivamente suportados no perfil Lab V1 / Prix IV Uno 90AX.
 * editavel=false → somente leitura.
 */
const PARAMETROS_META = Object.freeze({
  departamento_padrao: {
    nome: 'departamento_padrao',
    label: 'Departamento padrão',
    tipo: 'number',
    min: 0,
    max: 99,
    obrigatorio: false,
    editavel: true,
    padrao: 1
  },
  casas_decimais: {
    nome: 'casas_decimais',
    label: 'Casas decimais',
    tipo: 'number',
    min: 0,
    max: 3,
    obrigatorio: true,
    editavel: true,
    padrao: 3
  },
  unidade: {
    nome: 'unidade',
    label: 'Unidade de peso',
    tipo: 'enum',
    valores: ['kg', 'g'],
    obrigatorio: true,
    editavel: true,
    padrao: 'kg'
  },
  beep_habilitado: {
    nome: 'beep_habilitado',
    label: 'Beep habilitado',
    tipo: 'boolean',
    obrigatorio: false,
    editavel: true,
    padrao: true
  },
  backlight: {
    nome: 'backlight',
    label: 'Backlight',
    tipo: 'boolean',
    obrigatorio: false,
    editavel: true,
    padrao: true
  },
  timeout_display_s: {
    nome: 'timeout_display_s',
    label: 'Timeout display (s)',
    tipo: 'number',
    min: 1,
    max: 300,
    obrigatorio: false,
    editavel: true,
    padrao: 30
  },
  modo_etiqueta: {
    nome: 'modo_etiqueta',
    label: 'Modo etiqueta',
    tipo: 'enum',
    valores: ['peso', 'preco', 'total'],
    obrigatorio: false,
    editavel: true,
    padrao: 'peso'
  },
  serial_number: {
    nome: 'serial_number',
    label: 'Número de série',
    tipo: 'string',
    obrigatorio: false,
    editavel: false,
    padrao: ''
  },
  /** RC15.0.2 — interface física da balança (ETHERNET | WLAN) */
  INTERFACE: {
    nome: 'INTERFACE',
    label: 'Interface de rede',
    tipo: 'enum',
    valores: ['ETHERNET', 'WLAN'],
    obrigatorio: false,
    editavel: false,
    padrao: null
  },
  firmware: {
    nome: 'firmware',
    label: 'Firmware',
    tipo: 'string',
    obrigatorio: false,
    editavel: false,
    padrao: FIRMWARE_ALVO
  }
});

function createProfile({ nome = 'Padrao', parametros = {}, firmware, modelo } = {}) {
  const fw = firmware || FIRMWARE_ALVO;
  const mod = modelo || MODELO;
  const base = {};
  for (const [key, meta] of Object.entries(PARAMETROS_META)) {
    if (parametros[key] !== undefined) base[key] = parametros[key];
    else base[key] = meta.padrao;
  }
  return {
    nome,
    modelo: mod,
    firmware: fw,
    driver: DRIVER,
    parametros: base,
    meta: { ...PARAMETROS_META }
  };
}

function listSupportedParams({ firmware, modelo } = {}) {
  const fw = firmware || FIRMWARE_ALVO;
  const mod = modelo || MODELO;
  // Perfil único V1 — filtra apenas os validados para o alvo
  if (String(mod).toLowerCase().includes('prix') || mod === MODELO) {
    return Object.values(PARAMETROS_META).map((m) => ({ ...m, firmware: fw, modelo: mod }));
  }
  return [];
}

function getMeta(parametro) {
  return PARAMETROS_META[parametro] || null;
}

function isEditable(parametro) {
  const m = getMeta(parametro);
  return !!(m && m.editavel);
}

module.exports = {
  PARAMETROS_META,
  createProfile,
  listSupportedParams,
  getMeta,
  isEditable,
  MODELO,
  FIRMWARE_ALVO
};
