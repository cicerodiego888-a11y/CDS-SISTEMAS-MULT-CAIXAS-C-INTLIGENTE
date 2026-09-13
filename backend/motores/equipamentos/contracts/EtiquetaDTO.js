/**
 * EtiquetaDTO — Contrato oficial de etiqueta para o Motor Equipamentos.
 *
 * @class EtiquetaDTO
 */

class EtiquetaDTO {
  constructor(dados = {}) {
    this.layout = dados.layout ?? 'padrao';
    this.plu = dados.plu ?? null;
    this.descricao = dados.descricao ?? '';
    this.preco = dados.preco != null ? Number(dados.preco) : null;
    this.validade = dados.validade ?? null;
    this.formatoCodigoBarras = dados.formatoCodigoBarras ?? null;
    this.extras = dados.extras ?? {};
  }

  validar() {
    const EtiquetaValidator = require('./EtiquetaValidator');
    return EtiquetaValidator.validar(this);
  }

  toJSON() {
    return {
      layout: this.layout,
      plu: this.plu,
      descricao: this.descricao,
      preco: this.preco,
      validade: this.validade,
      formatoCodigoBarras: this.formatoCodigoBarras,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new EtiquetaDTO(plain || {});
  }
}

module.exports = EtiquetaDTO;
