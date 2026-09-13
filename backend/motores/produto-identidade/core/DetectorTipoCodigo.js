/**
 * DetectorTipoCodigo — classifica a entrada bruta (Sprint 02).
 * Não resolve produto; apenas sugere tipos candidatos ordenados.
 * @module motores/produto-identidade/core/DetectorTipoCodigo
 */

const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');

class DetectorTipoCodigo {
  /**
   * @param {string|number|null} codigo
   * @param {Object} [contexto]
   * @returns {{ bruto: string, limpo: string, digitos: string, candidatos: string[] }}
   */
  detectar(codigo, contexto = {}) {
    const bruto = String(codigo ?? '').trim();
    const limpo = bruto;
    const digitos = bruto.replace(/\D/g, '');
    const candidatos = [];

    if (!bruto) {
      return { bruto, limpo, digitos, candidatos: [] };
    }

    // Override explícito
    if (contexto.tipoForcado && TIPOS_IDENTIFICADOR[contexto.tipoForcado]) {
      return {
        bruto,
        limpo,
        digitos,
        candidatos: [String(contexto.tipoForcado).toUpperCase()]
      };
    }

    const soDigitos = digitos.length > 0 && digitos === bruto.replace(/\s/g, '');

    // Etiqueta de balança (prefixo 2 + 12 dígitos) — prioridade sobre EAN comercial
    if (soDigitos && /^2\d{12}$/.test(digitos)) {
      candidatos.push('ETIQUETA_BALANCA');
    }

    if (soDigitos && digitos.length === 14) {
      candidatos.push(TIPOS_IDENTIFICADOR.GTIN);
    }
    if (soDigitos && digitos.length === 13 && !/^2\d{12}$/.test(digitos)) {
      candidatos.push(TIPOS_IDENTIFICADOR.EAN13);
    }
    if (soDigitos && digitos.length === 8) {
      candidatos.push(TIPOS_IDENTIFICADOR.EAN8);
    }

    // Interno antes de ID: códigos curtos ("67") priorizam codigo cadastral
    candidatos.push(TIPOS_IDENTIFICADOR.INTERNO);

    // PLU tipado (cadastro balança) — códigos curtos numéricos
    if (soDigitos && digitos.length >= 1 && digitos.length <= 6) {
      candidatos.push(TIPOS_IDENTIFICADOR.PLU);
    }

    if (soDigitos && digitos.length >= 1 && digitos.length <= 9 && digitos.length !== 8) {
      const n = Number(digitos);
      if (Number.isInteger(n) && n > 0 && !/^0\d+/.test(digitos)) {
        candidatos.push(TIPOS_IDENTIFICADOR.ID);
      }
    }

    // Dedup preservando ordem
    const vistos = new Set();
    const unicos = [];
    for (const c of candidatos) {
      if (!vistos.has(c)) {
        vistos.add(c);
        unicos.push(c);
      }
    }

    return { bruto, limpo, digitos, candidatos: unicos };
  }
}

module.exports = DetectorTipoCodigo;
