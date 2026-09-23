/**
 * Política monetária única do CDS — valores em centavos.
 * Tolerância oficial: R$ 0,02. Não aumentar para esconder divergência.
 */
'use strict';

const TOLERANCIA = 0.02;
const TOLERANCIA_CENTAVOS = 2;

function n(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  return 0;
}

function toCents(valor) {
  return Math.round((n(valor) + Number.EPSILON) * 100);
}

function fromCents(cents) {
  return Math.round(n(cents)) / 100;
}

function arred2(valor) {
  return fromCents(toCents(valor));
}

/**
 * Parsing monetário brasileiro oficial.
 * Aceita: 5 | 5.00 | 5,00 | 5.5 | 5,50 | 1.234,56 | 1234,56
 * Não interpreta "5,00" como 5 mil.
 */
function parseMoedaBr(valor) {
  if (valor == null || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? arred2(valor) : 0;

  let texto = String(valor).trim().replace(/\s/g, '').replace(/R\$/gi, '');
  if (!texto) return 0;
  if (texto.startsWith('(') && texto.endsWith(')')) {
    texto = `-${texto.slice(1, -1)}`;
  }
  const negativo = texto.startsWith('-');
  if (negativo) texto = texto.slice(1);
  texto = texto.replace(/[^\d.,]/g, '');
  if (!texto) return 0;

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
      texto = texto.replace(/\./g, '').replace(',', '.');
    } else {
      texto = texto.replace(/,/g, '');
    }
  } else if (temVirgula) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temPonto) {
    const partes = texto.split('.');
    if (partes.length > 2) {
      const decimais = partes.pop();
      texto = `${partes.join('')}.${decimais}`;
    } else if (partes[1] && partes[1].length === 3 && partes[0] !== '') {
      texto = partes.join('');
    }
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 0;
  const resultado = arred2(numero);
  return negativo ? arred2(-resultado) : resultado;
}

function quaseIgual(a, b, tolerancia = TOLERANCIA) {
  return Math.abs(arred2(a) - arred2(b)) <= tolerancia + 1e-9;
}

function diffAbs(a, b) {
  return arred2(Math.abs(arred2(a) - arred2(b)));
}

function somar(...valores) {
  return fromCents(valores.reduce((acc, valor) => acc + toCents(valor), 0));
}

function subtrair(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

module.exports = {
  TOLERANCIA,
  TOLERANCIA_CENTAVOS,
  n,
  toCents,
  fromCents,
  arred2,
  parseMoedaBr,
  quaseIgual,
  diffAbs,
  somar,
  subtrair
};
