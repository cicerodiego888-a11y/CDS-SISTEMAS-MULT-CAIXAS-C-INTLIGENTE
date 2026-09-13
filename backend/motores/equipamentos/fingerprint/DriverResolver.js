/**
 * Sprint 14.2 — DriverResolver
 * Decide qual Driver usar no futuro. Não instancia Driver.
 */

'use strict';

const MAPA_PROTOCOLO_DRIVER = Object.freeze({
  TOLEDO_ETH: {
    driver: 'TOLEDO_PRIX4_UNO',
    fabricante: 'Toledo',
    modelo: 'Prix IV Uno'
  },
  TOLEDO_90AX: {
    driver: 'TOLEDO_PRIX4_UNO',
    fabricante: 'Toledo',
    modelo: 'Prix IV Uno'
  },
  FILIZOLA: {
    driver: 'FILIZOLA_PLATINA',
    fabricante: 'Filizola',
    modelo: null
  },
  URANO: {
    driver: 'URANO',
    fabricante: 'Urano',
    modelo: null
  },
  ELGIN: {
    driver: 'ELGIN_DP30',
    fabricante: 'Elgin',
    modelo: null
  }
});

class DriverResolver {
  constructor({ mapa = MAPA_PROTOCOLO_DRIVER } = {}) {
    this.mapa = mapa || MAPA_PROTOCOLO_DRIVER;
  }

  /**
   * @param {string|null} protocol
   * @param {{confidence?:number}} [meta]
   * @returns {{driver:string|null, fabricante:string|null, modelo:string|null}}
   */
  resolve(protocol, meta = {}) {
    const key = protocol != null ? String(protocol).toUpperCase().trim() : '';
    if (!key) {
      return { driver: null, fabricante: null, modelo: null };
    }
    const hit = this.mapa[key];
    if (!hit) {
      return { driver: null, fabricante: null, modelo: null };
    }
    return {
      driver: hit.driver || null,
      fabricante: hit.fabricante || null,
      modelo: hit.modelo != null ? hit.modelo : null,
      confidenceHint: meta.confidence
    };
  }

  listarMapeamentos() {
    return { ...this.mapa };
  }
}

module.exports = DriverResolver;
module.exports.DriverResolver = DriverResolver;
module.exports.MAPA_PROTOCOLO_DRIVER = MAPA_PROTOCOLO_DRIVER;
