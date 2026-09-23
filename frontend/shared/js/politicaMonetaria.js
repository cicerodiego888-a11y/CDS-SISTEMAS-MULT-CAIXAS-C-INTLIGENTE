/**
 * Política monetária única do CDS (frontend).
 * Espelha backend/services/financeiro/politicaMonetaria.js
 */
(function (global) {
  'use strict';

  var TOLERANCIA = 0.02;

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

  function parseMoedaBr(valor) {
    if (valor == null || valor === '') return 0;
    if (typeof valor === 'number') return Number.isFinite(valor) ? arred2(valor) : 0;

    var texto = String(valor).trim().replace(/\s/g, '').replace(/R\$/gi, '');
    if (!texto) return 0;
    if (texto.charAt(0) === '(' && texto.charAt(texto.length - 1) === ')') {
      texto = '-' + texto.slice(1, -1);
    }
    var negativo = texto.charAt(0) === '-';
    if (negativo) texto = texto.slice(1);
    texto = texto.replace(/[^\d.,]/g, '');
    if (!texto) return 0;

    var temVirgula = texto.indexOf(',') >= 0;
    var temPonto = texto.indexOf('.') >= 0;

    if (temVirgula && temPonto) {
      if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
        texto = texto.replace(/\./g, '').replace(',', '.');
      } else {
        texto = texto.replace(/,/g, '');
      }
    } else if (temVirgula) {
      texto = texto.replace(/\./g, '').replace(',', '.');
    } else if (temPonto) {
      var partes = texto.split('.');
      if (partes.length > 2) {
        var decimais = partes.pop();
        texto = partes.join('') + '.' + decimais;
      } else if (partes[1] && partes[1].length === 3 && partes[0] !== '') {
        texto = partes.join('');
      }
    }

    var numero = Number(texto);
    if (!Number.isFinite(numero)) return 0;
    var resultado = arred2(numero);
    return negativo ? arred2(-resultado) : resultado;
  }

  function quaseIgual(a, b, tolerancia) {
    return Math.abs(arred2(a) - arred2(b)) <= (tolerancia == null ? TOLERANCIA : tolerancia) + 1e-9;
  }

  var api = {
    TOLERANCIA: TOLERANCIA,
    n: n,
    toCents: toCents,
    fromCents: fromCents,
    arred2: arred2,
    parseMoedaBr: parseMoedaBr,
    quaseIgual: quaseIgual
  };

  global.CdsPoliticaMonetaria = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
