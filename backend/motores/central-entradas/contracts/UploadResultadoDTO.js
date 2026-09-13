/**
 * UploadResultadoDTO — Resultado do upload de XML na Central.
 *
 * Sprint 10 — Upload XML Enterprise.
 *
 * @class UploadResultadoDTO
 */

class UploadResultadoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.sucesso = dados.sucesso ?? false;
    this.totalEnviados = dados.totalEnviados ?? 0;
    this.importados = dados.importados ?? 0;
    this.duplicados = dados.duplicados ?? 0;
    this.invalidos = dados.invalidos ?? 0;
    this.cancelados = dados.cancelados ?? 0;
    this.erros = dados.erros ?? 0;
    this.mensagem = dados.mensagem ?? null;
    this.itens = Array.isArray(dados.itens) ? dados.itens : [];
  }

  /**
   * @param {Object} [dados]
   * @returns {UploadResultadoDTO}
   */
  static create(dados = {}) {
    return new UploadResultadoDTO(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      sucesso: this.sucesso,
      totalEnviados: this.totalEnviados,
      importados: this.importados,
      duplicados: this.duplicados,
      invalidos: this.invalidos,
      cancelados: this.cancelados,
      erros: this.erros,
      mensagem: this.mensagem,
      itens: this.itens
    };
  }
}

module.exports = UploadResultadoDTO;
