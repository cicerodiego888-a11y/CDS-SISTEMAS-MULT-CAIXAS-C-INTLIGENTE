/**
 * DepartamentoDTO — Contrato oficial de departamento para o Motor Equipamentos.
 *
 * @class DepartamentoDTO
 */

class DepartamentoDTO {
  constructor(dados = {}) {
    this.codigo = dados.codigo ?? null;
    this.nome = dados.nome ?? '';
    this.origemId = dados.origemId ?? null;
    this.origemTipo = dados.origemTipo ?? 'categoria';
    this.extras = dados.extras ?? {};
  }

  validar() {
    const DepartamentoValidator = require('./DepartamentoValidator');
    return DepartamentoValidator.validar(this);
  }

  toJSON() {
    return {
      codigo: this.codigo,
      nome: this.nome,
      origemId: this.origemId,
      origemTipo: this.origemTipo,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new DepartamentoDTO(plain || {});
  }
}

module.exports = DepartamentoDTO;
