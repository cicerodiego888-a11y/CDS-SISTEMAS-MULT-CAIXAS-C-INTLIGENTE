/**
 * PesoDTO — Contrato oficial de leitura de peso do Motor Equipamentos.
 *
 * @class PesoDTO
 */

class PesoDTO {
  constructor(dados = {}) {
    this.valor = dados.valor != null ? Number(dados.valor) : null;
    this.unidade = dados.unidade ?? 'kg';
    this.estavel = Boolean(dados.estavel);
    this.simulado = Boolean(dados.simulado);
    this.timestamp = dados.timestamp ?? new Date().toISOString();
    this.extras = dados.extras ?? {};
  }

  validar() {
    const erros = [];
    if (this.valor != null && !Number.isFinite(this.valor)) {
      erros.push('Valor do peso inválido');
    }
    if (this.valor != null && this.valor < 0) {
      erros.push('Peso não pode ser negativo');
    }
    const unidades = ['kg', 'g', 'un'];
    if (this.unidade && !unidades.includes(String(this.unidade).toLowerCase())) {
      erros.push(`Unidade de peso inválida: ${this.unidade}`);
    }
    return { valido: erros.length === 0, erros };
  }

  toJSON() {
    return {
      valor: this.valor,
      unidade: this.unidade,
      estavel: this.estavel,
      simulado: this.simulado,
      timestamp: this.timestamp,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new PesoDTO(plain || {});
  }
}

module.exports = PesoDTO;
