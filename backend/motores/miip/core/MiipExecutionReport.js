/**
 * MiipExecutionReport — Relatório completo de uma execução MIIP.
 *
 * Sprint 14 — Observabilidade e Telemetria.
 *
 * @class MiipExecutionReport
 */

const MiipHealthStatus = require('./MiipHealthStatus');

const VERSAO_PADRAO = '1.0.0';

class MiipExecutionReport {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.requestId = dados.requestId ?? null;
    this.enginesExecutados = Array.isArray(dados.enginesExecutados)
      ? [...dados.enginesExecutados]
      : [];
    this.tempoTotal = dados.tempoTotal ?? 0;
    this.tempoPorEngine = dados.tempoPorEngine ?? {};
    this.produtoSelecionado = dados.produtoSelecionado ?? null;
    this.decisao = dados.decisao ?? null;
    this.nivelConfianca = dados.nivelConfianca ?? null;
    this.scoreFinal = dados.scoreFinal ?? null;
    this.quantidadeCandidatos = dados.quantidadeCandidatos ?? 0;
    this.explicacao = dados.explicacao ?? null;
    this.warnings = Array.isArray(dados.warnings) ? [...dados.warnings] : [];
    this.errors = Array.isArray(dados.errors) ? [...dados.errors] : [];
    this.health = dados.health ?? MiipHealthStatus.OK;
    this.iniciadoEm = dados.iniciadoEm ?? null;
    this.finalizadoEm = dados.finalizadoEm ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {MiipExecutionReport}
   */
  static create(dados = {}) {
    return new MiipExecutionReport(dados);
  }

  /**
   * @returns {boolean}
   */
  isCompleto() {
    return Boolean(
      this.requestId
      && this.tempoTotal >= 0
      && this.enginesExecutados.length >= 0
      && (this.decisao || this.errors.length > 0)
    );
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      requestId: this.requestId,
      enginesExecutados: this.enginesExecutados,
      tempoTotal: this.tempoTotal,
      tempoPorEngine: this.tempoPorEngine,
      produtoSelecionado: this.produtoSelecionado,
      decisao: this.decisao,
      nivelConfianca: this.nivelConfianca,
      scoreFinal: this.scoreFinal,
      quantidadeCandidatos: this.quantidadeCandidatos,
      explicacao: this.explicacao,
      warnings: this.warnings,
      errors: this.errors,
      health: this.health,
      iniciadoEm: this.iniciadoEm,
      finalizadoEm: this.finalizadoEm
    };
  }
}

MiipExecutionReport.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = MiipExecutionReport;
