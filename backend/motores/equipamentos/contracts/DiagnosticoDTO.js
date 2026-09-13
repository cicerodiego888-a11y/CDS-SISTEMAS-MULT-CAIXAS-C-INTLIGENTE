/**
 * DiagnosticoDTO — Contrato oficial de diagnóstico de equipamento.
 *
 * @class DiagnosticoDTO
 */

class DiagnosticoDTO {
  constructor(dados = {}) {
    this.sucesso = Boolean(dados.sucesso);
    this.simulado = Boolean(dados.simulado);
    this.comunicacaoReal = Boolean(dados.comunicacaoReal ?? dados.comunicacao_real);
    this.componentes = dados.componentes ?? {};
    this.mensagens = Array.isArray(dados.mensagens) ? dados.mensagens : [];
    this.erros = Array.isArray(dados.erros) ? dados.erros : [];
    this.timestamp = dados.timestamp ?? new Date().toISOString();
    this.extras = dados.extras ?? {};
  }

  validar() {
    const erros = [];
    if (!this.timestamp || Number.isNaN(Date.parse(this.timestamp))) {
      erros.push('Timestamp de diagnóstico inválido');
    }
    return { valido: erros.length === 0, erros };
  }

  toJSON() {
    return {
      sucesso: this.sucesso,
      simulado: this.simulado,
      comunicacao_real: this.comunicacaoReal,
      componentes: this.componentes,
      mensagens: this.mensagens,
      erros: this.erros,
      timestamp: this.timestamp,
      extras: this.extras
    };
  }

  static fromJSON(plain) {
    return new DiagnosticoDTO(plain || {});
  }
}

module.exports = DiagnosticoDTO;
