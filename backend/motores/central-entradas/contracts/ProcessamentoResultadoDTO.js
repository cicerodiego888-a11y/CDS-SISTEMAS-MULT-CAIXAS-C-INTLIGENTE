/**
 * ProcessamentoResultadoDTO — Contrato de resultado do pipeline de processamento.
 *
 * @class ProcessamentoResultadoDTO
 */

class ProcessamentoResultadoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.sucesso = dados.sucesso ?? false;
    this.documento = dados.documento ?? null;
    this.parse = dados.parse ?? null;
    this.miipImportacao = dados.miipImportacao ?? dados.miip_importacao ?? null;
    this.proximaAcao = dados.proximaAcao ?? dados.proxima_acao ?? null;
    this.etapaAtual = dados.etapaAtual ?? dados.etapa_atual ?? null;
    this.etapas = dados.etapas ?? [];
    this.possuiPendencias = dados.possuiPendencias ?? dados.possui_pendencias ?? false;
    this.reutilizado = dados.reutilizado ?? false;
    this.mensagem = dados.mensagem ?? null;
    this.erros = dados.erros ?? [];
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {ProcessamentoResultadoDTO}
   */
  static create(plain) {
    return new ProcessamentoResultadoDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      sucesso: this.sucesso,
      documento: this.documento,
      parse: this.parse,
      miipImportacao: this.miipImportacao,
      proximaAcao: this.proximaAcao,
      etapaAtual: this.etapaAtual,
      etapas: this.etapas,
      possuiPendencias: this.possuiPendencias,
      reutilizado: this.reutilizado,
      mensagem: this.mensagem,
      erros: this.erros
    };
  }
}

module.exports = ProcessamentoResultadoDTO;
