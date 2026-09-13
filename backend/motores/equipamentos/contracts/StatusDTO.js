/**
 * StatusDTO — Contrato oficial de status de equipamento.
 *
 * @class StatusDTO
 */

class StatusDTO {
  constructor(dados = {}) {
    this.online = Boolean(dados.online);
    this.conectado = Boolean(dados.conectado);
    this.fabricante = dados.fabricante ?? null;
    this.modelo = dados.modelo ?? null;
    this.firmware = dados.firmware ?? null;
    this.ultimaComunicacao = dados.ultimaComunicacao ?? null;
    this.mensagem = dados.mensagem ?? '';
    this.erros = Array.isArray(dados.erros) ? dados.erros : [];
    this.extras = dados.extras ?? {};
  }

  validar() {
    const erros = [];
    if (this.ultimaComunicacao && Number.isNaN(Date.parse(this.ultimaComunicacao))) {
      erros.push('Data de última comunicação inválida');
    }
    return { valido: erros.length === 0, erros };
  }

  toJSON() {
    return {
      online: this.online,
      conectado: this.conectado,
      fabricante: this.fabricante,
      modelo: this.modelo,
      firmware: this.firmware,
      ultimaComunicacao: this.ultimaComunicacao,
      mensagem: this.mensagem,
      erros: this.erros,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new StatusDTO(plain || {});
  }
}

module.exports = StatusDTO;
