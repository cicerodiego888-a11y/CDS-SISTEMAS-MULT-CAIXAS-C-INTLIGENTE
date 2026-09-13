/**
 * PromocaoDTO — Contrato oficial de promoção para o Motor Equipamentos.
 *
 * @class PromocaoDTO
 */

class PromocaoDTO {
  constructor(dados = {}) {
    this.plu = dados.plu ?? dados.codigo ?? null;
    this.precoPromocional = Number(dados.precoPromocional ?? 0);
    this.precoOriginal = dados.precoOriginal != null ? Number(dados.precoOriginal) : null;
    this.dataInicio = dados.dataInicio ?? null;
    this.dataFim = dados.dataFim ?? null;
    this.ativa = Boolean(dados.ativa);
    this.extras = dados.extras ?? {};
  }

  validar() {
    const PromocaoValidator = require('./PromocaoValidator');
    return PromocaoValidator.validar(this);
  }

  toJSON() {
    return {
      plu: this.plu,
      precoPromocional: this.precoPromocional,
      precoOriginal: this.precoOriginal,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
      ativa: this.ativa,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new PromocaoDTO(plain || {});
  }
}

module.exports = PromocaoDTO;
