/**
 * CentralDashboardDTO — Contrato de KPIs do dashboard da Central.
 *
 * @class CentralDashboardDTO
 */

class CentralDashboardDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.contadores = dados.contadores ?? {};
    this.indicadores = dados.indicadores ?? null;
    this.ultimaSincronizacao = dados.ultimaSincronizacao ?? dados.ultima_sincronizacao ?? null;
    this.sincronizacao = dados.sincronizacao ?? null;
    this.xmlWait = dados.xmlWait ?? null;
    this.sefazOperacional = dados.sefazOperacional ?? null;
    this.saude = dados.saude ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {CentralDashboardDTO}
   */
  static create(plain) {
    return new CentralDashboardDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      contadores: this.contadores,
      indicadores: this.indicadores,
      ultimaSincronizacao: this.ultimaSincronizacao,
      sincronizacao: this.sincronizacao,
      xmlWait: this.xmlWait,
      sefazOperacional: this.sefazOperacional,
      saude: this.saude
    };
  }
}

module.exports = CentralDashboardDTO;
