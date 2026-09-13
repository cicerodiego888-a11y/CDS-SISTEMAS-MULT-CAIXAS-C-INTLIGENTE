/**
 * SincronizacaoResultadoDTO — Contrato de resultado da sincronização DF-e.
 *
 * @class SincronizacaoResultadoDTO
 */

class SincronizacaoResultadoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.sucesso = dados.sucesso ?? false;
    this.notasNovas = dados.notasNovas ?? dados.notas_novas ?? 0;
    this.notasDuplicadas = dados.notasDuplicadas ?? dados.notas_duplicadas ?? 0;
    this.ignorados = dados.ignorados ?? 0;
    this.ultNsu = dados.ultNsu ?? dados.ult_nsu ?? null;
    this.maxNsu = dados.maxNsu ?? dados.max_nsu ?? null;
    this.iteracoes = dados.iteracoes ?? 0;
    this.cStat = dados.cStat ?? null;
    this.mensagem = dados.mensagem ?? null;
    this.ultimaSincronizacao = dados.ultimaSincronizacao ?? dados.ultima_sincronizacao ?? null;
    this.erros = dados.erros ?? [];
    this.codigoErro = dados.codigoErro ?? dados.codigo_erro ?? null;
    this.mensagemAmigavel = dados.mensagemAmigavel ?? dados.mensagem_amigavel ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {SincronizacaoResultadoDTO}
   */
  static create(plain) {
    return new SincronizacaoResultadoDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      sucesso: this.sucesso,
      notasNovas: this.notasNovas,
      notasDuplicadas: this.notasDuplicadas,
      ignorados: this.ignorados,
      ultNsu: this.ultNsu,
      maxNsu: this.maxNsu,
      iteracoes: this.iteracoes,
      cStat: this.cStat,
      mensagem: this.mensagem,
      ultimaSincronizacao: this.ultimaSincronizacao,
      erros: this.erros,
      codigoErro: this.codigoErro,
      mensagemAmigavel: this.mensagemAmigavel || this.mensagem || (this.erros[0] || null)
    };
  }
}

module.exports = SincronizacaoResultadoDTO;
