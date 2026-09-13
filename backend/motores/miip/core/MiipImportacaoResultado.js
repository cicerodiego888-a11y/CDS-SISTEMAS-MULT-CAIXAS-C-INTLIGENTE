/**
 * MiipImportacaoResultado — Resultado MIIP de um item da importação XML.
 *
 * Sprint 6A: armazenado em memória durante a importação; sem confirmação na leitura.
 *
 * @class MiipImportacaoResultado
 */

class MiipImportacaoResultado {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.indice = Number(dados.indice ?? 0);
    this.produtoXML = dados.produtoXML ?? null;
    this.produtoEncontrado = dados.produtoEncontrado ?? null;
    this.nivelCerteza = dados.nivelCerteza ?? 'NENHUMA';
    this.acao = dados.acao ?? null;
    this.motivos = Array.isArray(dados.motivos) ? [...dados.motivos] : [];
    this.candidatoSelecionado = dados.candidatoSelecionado ?? null;
    this.precisaConfirmacao = Boolean(dados.precisaConfirmacao);
    this.precisaCadastro = Boolean(dados.precisaCadastro);
    this.associadoAutomaticamente = Boolean(dados.associadoAutomaticamente);
    this.score = Number(dados.score ?? 0);
    this.motor = dados.motor ?? null;
    this.operacaoId = dados.operacaoId ?? null;
    this.mie = dados.mie ?? null;
    this.candidatos = Array.isArray(dados.candidatos) ? [...dados.candidatos] : [];
    this.diagnosticoBusca = dados.diagnosticoBusca ?? null;
  }

  /**
   * @param {Object} dados
   * @returns {MiipImportacaoResultado}
   */
  static create(dados = {}) {
    return new MiipImportacaoResultado(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      indice: this.indice,
      produtoXML: this.produtoXML,
      produtoEncontrado: this.produtoEncontrado,
      nivelCerteza: this.nivelCerteza,
      acao: this.acao,
      motivos: this.motivos,
      candidatoSelecionado: this.candidatoSelecionado,
      precisaConfirmacao: this.precisaConfirmacao,
      precisaCadastro: this.precisaCadastro,
      associadoAutomaticamente: this.associadoAutomaticamente,
      score: this.score,
      motor: this.motor,
      operacaoId: this.operacaoId,
      mie: this.mie,
      candidatos: this.candidatos,
      diagnosticoBusca: this.diagnosticoBusca
    };
  }
}

module.exports = MiipImportacaoResultado;
