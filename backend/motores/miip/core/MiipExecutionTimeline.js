/**
 * MiipExecutionTimeline — Registro cronológico das etapas do Pipeline MIIP.
 *
 * Cada etapa armazena: nome, início, fim, duração e status.
 *
 * @class MiipExecutionTimeline
 */

class MiipExecutionTimeline {
  constructor() {
    /** @private @type {Object[]} */
    this._etapas = [];
    /** @private @type {Object|null} */
    this._etapaAtual = null;
  }

  /**
   * Inicia uma etapa do pipeline.
   *
   * @param {string} nome
   * @param {Object} [meta]
   * @returns {Object}
   */
  iniciar(nome, meta = {}) {
    const etapa = {
      nome: String(nome || 'desconhecida'),
      inicio: new Date().toISOString(),
      fim: null,
      duracaoMs: 0,
      status: 'em_andamento',
      meta: meta ?? {}
    };

    this._etapaAtual = etapa;
    this._etapas.push(etapa);
    return etapa;
  }

  /**
   * Finaliza a etapa em andamento.
   *
   * @param {string} [status='ok']
   * @param {Object} [meta]
   * @returns {Object|null}
   */
  finalizar(status = 'ok', meta = {}) {
    if (!this._etapaAtual) return null;

    const fim = Date.now();
    const inicioMs = Date.parse(this._etapaAtual.inicio) || fim;

    this._etapaAtual.fim = new Date(fim).toISOString();
    this._etapaAtual.duracaoMs = Math.max(0, fim - inicioMs);
    this._etapaAtual.status = status;
    this._etapaAtual.meta = { ...this._etapaAtual.meta, ...meta };

    const concluida = this._etapaAtual;
    this._etapaAtual = null;
    return concluida;
  }

  /**
   * Executa callback com etapa automaticamente registrada.
   *
   * @param {string} nome
   * @param {Function} fn
   * @returns {Promise<*>}
   */
  async executarEtapa(nome, fn) {
    this.iniciar(nome);

    try {
      const resultado = await fn();
      this.finalizar('ok');
      return resultado;
    } catch (error) {
      this.finalizar('erro', { erro: error?.message || String(error) });
      throw error;
    }
  }

  /**
   * @returns {Object[]}
   */
  listar() {
    return [...this._etapas];
  }

  /**
   * @returns {number}
   */
  duracaoTotalMs() {
    return this._etapas.reduce((acc, etapa) => acc + Number(etapa.duracaoMs || 0), 0);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      etapas: this.listar(),
      duracaoTotalMs: this.duracaoTotalMs()
    };
  }
}

module.exports = MiipExecutionTimeline;
