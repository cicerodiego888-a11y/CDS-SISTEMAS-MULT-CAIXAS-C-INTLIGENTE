/**
 * MiipExplanation — Explicação oficial de uma decisão MIIP.
 *
 * Sprint 12 — Camada de Explicabilidade.
 *
 * @class MiipExplanation
 */

const VERSAO_PADRAO = '1.0.0';

class MiipExplanation {
  /**
   * @param {Object} [dados]
   * @param {string|null} [dados.titulo]
   * @param {string|null} [dados.resumo]
   * @param {string|null} [dados.nivelCerteza]
   * @param {string[]} [dados.motivosPositivos]
   * @param {string[]} [dados.motivosNegativos]
   * @param {string[]} [dados.atributosCoincidentes]
   * @param {string[]} [dados.atributosDivergentes]
   * @param {string|null} [dados.explicacaoCompleta]
   * @param {string|null} [dados.explicacaoCurta]
   * @param {string|null} [dados.recomendacao]
   */
  constructor(dados = {}) {
    this.titulo = dados.titulo ?? '';
    this.resumo = dados.resumo ?? '';
    this.nivelCerteza = dados.nivelCerteza ?? null;
    this.motivosPositivos = Array.isArray(dados.motivosPositivos) ? [...dados.motivosPositivos] : [];
    this.motivosNegativos = Array.isArray(dados.motivosNegativos) ? [...dados.motivosNegativos] : [];
    this.atributosCoincidentes = Array.isArray(dados.atributosCoincidentes)
      ? [...dados.atributosCoincidentes]
      : [];
    this.atributosDivergentes = Array.isArray(dados.atributosDivergentes)
      ? [...dados.atributosDivergentes]
      : [];
    this.explicacaoCompleta = dados.explicacaoCompleta ?? '';
    this.explicacaoCurta = dados.explicacaoCurta ?? '';
    this.recomendacao = dados.recomendacao ?? '';
  }

  /**
   * @param {Object} [dados]
   * @returns {MiipExplanation}
   */
  static create(dados = {}) {
    return new MiipExplanation(dados);
  }

  /**
   * @returns {boolean}
   */
  temConteudo() {
    return Boolean(
      this.titulo
      || this.resumo
      || this.motivosPositivos.length
      || this.motivosNegativos.length
      || this.explicacaoCompleta
    );
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      titulo: this.titulo,
      resumo: this.resumo,
      nivelCerteza: this.nivelCerteza,
      motivosPositivos: this.motivosPositivos,
      motivosNegativos: this.motivosNegativos,
      atributosCoincidentes: this.atributosCoincidentes,
      atributosDivergentes: this.atributosDivergentes,
      explicacaoCompleta: this.explicacaoCompleta,
      explicacaoCurta: this.explicacaoCurta,
      recomendacao: this.recomendacao
    };
  }
}

MiipExplanation.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = MiipExplanation;
