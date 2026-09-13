/**
 * Sprint 14.2 — FingerprintCandidate
 * Resultado da identificação (sem comunicação oficial / sem Driver ativo).
 */

'use strict';

class FingerprintCandidate {
  /**
   * @param {object} dados
   */
  constructor(dados = {}) {
    this.host = String(dados.host || '');
    this.porta = Number(dados.porta) || 0;
    this.protocolo = dados.protocolo != null ? dados.protocolo : null;
    this.fabricante = dados.fabricante != null ? dados.fabricante : null;
    this.modelo = dados.modelo != null ? dados.modelo : null;
    this.driver = dados.driver != null ? dados.driver : null;
    this.confidence = Number(dados.confidence) || 0;
    this.fingerprint = dados.fingerprint != null ? String(dados.fingerprint) : null;
    this.identificadoEm = dados.identificadoEm || new Date().toISOString();
  }

  get identificado() {
    return Boolean(this.protocolo || this.fabricante || this.driver);
  }

  paraApi() {
    return {
      host: this.host,
      porta: this.porta,
      protocolo: this.protocolo,
      fabricante: this.fabricante,
      modelo: this.modelo,
      driver: this.driver,
      confidence: this.confidence,
      fingerprint: this.fingerprint,
      identificadoEm: this.identificadoEm
    };
  }

  /** Formato enxuto do aceite da sprint. */
  paraRespostaHttp() {
    return {
      host: this.host,
      porta: this.porta,
      fabricante: this.fabricante,
      modelo: this.modelo,
      driver: this.driver,
      confidence: this.confidence
    };
  }
}

module.exports = FingerprintCandidate;
module.exports.FingerprintCandidate = FingerprintCandidate;
