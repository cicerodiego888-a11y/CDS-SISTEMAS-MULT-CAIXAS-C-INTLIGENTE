/**
 * MiipExecution — Representa uma execução completa do Pipeline MIIP.
 *
 * @class MiipExecution
 */

const MiipExecutionState = require('./MiipExecutionState');
const MiipExecutionTimeline = require('./MiipExecutionTimeline');
const MiipCandidateCollection = require('./MiipCandidateCollection');

class MiipExecution {
  /**
   * @param {Object} [dados]
   * @param {string} dados.requestId
   * @param {import('./MiipContext')|Object|null} [dados.context]
   * @param {string} [dados.estado]
   */
  constructor(dados = {}) {
    this.requestId = dados.requestId;
    this.startedAt = dados.startedAt ?? new Date().toISOString();
    this.finishedAt = dados.finishedAt ?? null;
    this.duration = Number(dados.duration ?? 0);
    this.estado = dados.estado ?? MiipExecutionState.CRIADO;
    this.context = dados.context ?? null;
    this.configuracao = dados.configuracao ?? null;
    this.enginesExecutados = Array.isArray(dados.enginesExecutados) ? [...dados.enginesExecutados] : [];
    this.candidatos = dados.candidatos instanceof MiipCandidateCollection
      ? dados.candidatos
      : new MiipCandidateCollection();
    this.resultado = dados.resultado ?? null;
    this.relatorio = dados.relatorio ?? null;
    this.metricas = dados.metricas ?? null;
    this.logs = Array.isArray(dados.logs) ? [...dados.logs] : [];
    this.erro = dados.erro ?? null;
    this.timeline = dados.timeline instanceof MiipExecutionTimeline
      ? dados.timeline
      : new MiipExecutionTimeline();
  }

  /**
   * @param {import('./MiipRequest')} request
   * @returns {MiipExecution}
   */
  static criar(request) {
    return new MiipExecution({
      requestId: request.requestId,
      context: request.contexto,
      estado: MiipExecutionState.CRIADO
    });
  }

  /**
   * @param {string} estado
   */
  transicionar(estado) {
    this.estado = estado;
  }

  /**
   * @param {string} evento
   * @param {Object} [dados]
   */
  registrarLog(evento, dados = {}) {
    this.logs.push({
      evento,
      dados,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Finaliza execução com sucesso.
   */
  finalizar() {
    this.finishedAt = new Date().toISOString();
    this.duration = this.timeline.duracaoTotalMs();
    this.estado = MiipExecutionState.FINALIZADO;
  }

  /**
   * Finaliza execução com erro.
   *
   * @param {string|Error} erro
   */
  falhar(erro) {
    this.finishedAt = new Date().toISOString();
    this.duration = this.timeline.duracaoTotalMs();
    this.estado = MiipExecutionState.ERRO;
    this.erro = erro?.message || String(erro || 'Erro desconhecido');
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      requestId: this.requestId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      duration: this.duration,
      estado: this.estado,
      context: this.context?.toJSON?.() ?? this.context,
      configuracao: this.configuracao,
      enginesExecutados: this.enginesExecutados,
      candidatos: this.candidatos.toJSON(),
      resultado: this.resultado?.toJSON?.() ?? this.resultado,
      relatorio: this.relatorio,
      metricas: this.metricas,
      logs: this.logs,
      erro: this.erro,
      timeline: this.timeline.toJSON()
    };
  }
}

module.exports = MiipExecution;
