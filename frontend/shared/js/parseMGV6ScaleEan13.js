/**
 * RC14.15.21 — Parser de EAN-13 de etiqueta MGV6 (Código de Barras Tradicional).
 *
 * Configuração auditada da loja:
 *   Prefixo 2 | CCCC (4) | 0 | TTTTTT (preço total) | DV
 *
 * Ex.: 2001000004522 → itemCode 0010 → PLU 10 (não é preço, não é EAN comercial).
 */

'use strict';

const PREFIXO_PADRAO = '2';
const TAMANHO_EAN13 = 13;

/**
 * GS1: posições ímpares (1-indexed, da esquerda) ×1, pares ×3.
 * @param {string} dozeDigitos
 * @returns {number}
 */
function calcularDigitoVerificadorEan13(dozeDigitos) {
  const d = String(dozeDigitos || '');
  if (!/^\d{12}$/.test(d)) return NaN;
  let soma = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = Number(d[i]);
    soma += (i % 2 === 0) ? n : n * 3;
  }
  return (10 - (soma % 10)) % 10;
}

function validarDigitoVerificadorEan13(code) {
  const raw = String(code || '');
  if (!/^\d{13}$/.test(raw)) return false;
  const esperado = calcularDigitoVerificadorEan13(raw.slice(0, 12));
  return Number(raw[12]) === esperado;
}

/**
 * Normaliza só a leitura do scanner (espaços/lixo nas bordas),
 * sem usar replace para “descobrir” PLU no meio do EAN.
 * @param {*} entrada
 * @returns {string}
 */
function normalizarEntradaScanner(entrada) {
  return String(entrada == null ? '' : entrada).trim();
}

function apenasDigitosContiguos(entrada) {
  const t = normalizarEntradaScanner(entrada);
  if (/^\d+$/.test(t)) return t;
  const compacto = t.replace(/\s+/g, '');
  if (/^\d+$/.test(compacto)) return compacto;
  return '';
}

/**
 * @param {*} code
 * @param {{ prefixo?: string }} [opcoes]
 * @returns {null|{ok:false,reason:string}|object}
 */
function parseMGV6ScaleEan13(code, opcoes) {
  const opts = opcoes && typeof opcoes === 'object' ? opcoes : {};
  const prefixoEsperado = String(opts.prefixo != null ? opts.prefixo : PREFIXO_PADRAO).trim() || PREFIXO_PADRAO;

  const digits = apenasDigitosContiguos(code);
  if (digits.length !== TAMANHO_EAN13) return null;
  if (digits[0] !== prefixoEsperado) return null;
  if (digits[5] !== '0') return null;

  if (!validarDigitoVerificadorEan13(digits)) {
    return { ok: false, reason: 'DV_INVALID', type: 'MGV6_SCALE_EAN13', code: digits };
  }

  const itemCode = digits.slice(1, 5);
  const plu = Number(itemCode);
  const total = Number(digits.slice(6, 12));
  const dv = digits[12];

  if (!Number.isInteger(plu) || plu < 0) return null;
  if (!Number.isInteger(total) || total < 0) return null;

  return {
    ok: true,
    type: 'MGV6_SCALE_EAN13',
    prefix: digits[0],
    itemCode,
    plu,
    total,
    dv,
    code: digits
  };
}

const api = {
  PREFIXO_PADRAO,
  TAMANHO_EAN13,
  calcularDigitoVerificadorEan13,
  validarDigitoVerificadorEan13,
  parseMGV6ScaleEan13
};

if (typeof module === 'object' && module.exports) {
  module.exports = api;
}

const root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null);
if (root) {
  root.parseMGV6ScaleEan13 = parseMGV6ScaleEan13;
  root.ParseMGV6ScaleEan13 = api;
}
