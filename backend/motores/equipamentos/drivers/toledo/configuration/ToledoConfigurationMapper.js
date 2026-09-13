/**
 * Sprint 14.11 — ToledoConfigurationMapper
 * CDS ↔ Toledo (sem comunicação).
 */

'use strict';

const profile = require('./ToledoConfigurationProfile');

/**
 * CDS → domínio Toledo (apenas params suportados).
 */
function toToledo(cdsConfig = {}) {
  const src = cdsConfig.parametros || cdsConfig;
  const out = {};
  for (const key of Object.keys(profile.PARAMETROS_META)) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return {
    nome: cdsConfig.nome || 'CDS',
    modelo: cdsConfig.modelo || profile.MODELO,
    firmware: cdsConfig.firmware || profile.FIRMWARE_ALVO,
    parametros: out
  };
}

/**
 * Toledo/raw → CDS.
 */
function toCds(toledoConfig = {}) {
  const src = toledoConfig.parametros || toledoConfig;
  const out = {};
  for (const key of Object.keys(profile.PARAMETROS_META)) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return {
    nome: toledoConfig.nome || 'Balança',
    modelo: toledoConfig.modelo || profile.MODELO,
    firmware: toledoConfig.firmware || src.firmware || profile.FIRMWARE_ALVO,
    parametros: out
  };
}

/**
 * Diff entre dois conjuntos de parâmetros.
 */
function diff(atual = {}, proposto = {}) {
  const a = atual.parametros || atual;
  const b = proposto.parametros || proposto;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const itens = [];
  for (const key of keys) {
    if (!profile.getMeta(key)) continue;
    const va = a[key];
    const vb = b[key];
    const igual = String(va) === String(vb)
      || (typeof va === 'boolean' && typeof vb === 'boolean' && va === vb)
      || (Number.isFinite(Number(va)) && Number.isFinite(Number(vb)) && Number(va) === Number(vb));
    itens.push({
      parametro: key,
      valorAtual: va !== undefined ? va : null,
      valorNovo: vb !== undefined ? vb : null,
      status: igual ? 'IGUAL' : (vb === undefined ? 'AUSENTE' : (va === undefined ? 'NOVO' : 'ALTERADO')),
      editavel: profile.isEditable(key)
    });
  }
  return {
    itens,
    alterados: itens.filter((i) => i.status === 'ALTERADO' || i.status === 'NOVO'),
    iguais: itens.filter((i) => i.status === 'IGUAL').length
  };
}

module.exports = {
  toToledo,
  toCds,
  diff
};
