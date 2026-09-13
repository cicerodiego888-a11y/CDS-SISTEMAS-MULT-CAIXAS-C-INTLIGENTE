/**
 * MiipResponse — Resposta entregue pelo Pipeline MIIP.
 *
 * @class MiipResponse
 */

const MiipExecutionState = require('./MiipExecutionState');

class MiipResponse {
  /**
   * @param {Object} [dados]
   * @param {string} dados.requestId
   * @param {import('./MiipResult')|Object|null} [dados.resultado]
   * @param {Object|null} [dados.relatorio]
   * @param {import('./MiipExecution')} [dados.execution]
   * @param {boolean} [dados.sucesso]
   * @param {string|null} [dados.erro]
   */
  constructor(dados = {}) {
    this.requestId = dados.requestId ?? null;
    this.resultado = dados.resultado ?? null;
    this.relatorio = dados.relatorio ?? null;
    this.execution = dados.execution ?? null;
    this.sucesso = dados.sucesso !== false;
    this.erro = dados.erro ?? null;
    this.entregueEm = dados.entregueEm ?? new Date().toISOString();
  }

  /**
   * @param {import('./MiipExecution')} execution
   * @param {Object|null} relatorio
   * @returns {MiipResponse}
   */
  static fromExecution(execution, relatorio = null) {
    const sucesso = execution?.estado === MiipExecutionState.FINALIZADO;

    return new MiipResponse({
      requestId: execution?.requestId ?? null,
      resultado: execution?.resultado ?? null,
      relatorio: relatorio ?? execution?.relatorio ?? null,
      execution,
      sucesso,
      erro: execution?.erro ?? null
    });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      requestId: this.requestId,
      sucesso: this.sucesso,
      erro: this.erro,
      resultado: this.resultado?.toJSON?.() ?? this.resultado,
      relatorio: this.relatorio,
      entregueEm: this.entregueEm,
      durationMs: this.execution?.duration ?? null,
      estado: this.execution?.estado ?? null
    };
  }
}

module.exports = MiipResponse;
