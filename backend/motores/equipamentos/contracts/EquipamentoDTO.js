/**
 * EquipamentoDTO — Contrato oficial de configuração de equipamento.
 *
 * Representa um equipamento sem expor entidades SQLite ao motor de drivers.
 *
 * @class EquipamentoDTO
 */

class EquipamentoDTO {
  constructor(dados = {}) {
    this.id = dados.id ?? null;
    this.nome = dados.nome ?? '';
    this.fabricante = dados.fabricante ?? null;
    this.modelo = dados.modelo ?? null;
    this.driverCodigo = dados.driverCodigo ?? dados.driver_codigo ?? null;
    this.transporte = dados.transporte ?? 'ethernet';
    this.host = dados.host ?? dados.ip ?? null;
    this.porta = dados.porta ?? dados.porta_tcp ?? null;
    this.ativo = dados.ativo !== false;
    this.config = dados.config ?? {};
    this.extras = dados.extras ?? {};
  }

  validar() {
    const erros = [];
    if (!this.fabricante) erros.push('Fabricante é obrigatório');
    if (!this.modelo) erros.push('Modelo é obrigatório');
    if (!this.driverCodigo) erros.push('Código do driver é obrigatório');
    if (this.transporte === 'ethernet' && !this.host) {
      erros.push('Host é obrigatório para transporte ethernet');
    }
    if (this.porta != null) {
      const p = Number(this.porta);
      if (!Number.isFinite(p) || p < 1 || p > 65535) {
        erros.push('Porta inválida');
      }
    }
    return { valido: erros.length === 0, erros };
  }

  toJSON() {
    return {
      id: this.id,
      nome: this.nome,
      fabricante: this.fabricante,
      modelo: this.modelo,
      driverCodigo: this.driverCodigo,
      transporte: this.transporte,
      host: this.host,
      porta: this.porta,
      ativo: this.ativo,
      config: this.config,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new EquipamentoDTO(plain || {});
  }
}

module.exports = EquipamentoDTO;
