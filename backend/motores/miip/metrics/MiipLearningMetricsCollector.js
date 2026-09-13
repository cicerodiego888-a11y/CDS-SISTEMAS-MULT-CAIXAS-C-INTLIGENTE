/**
 * MiipLearningMetricsCollector — Métricas do serviço de aprendizado MIIP.
 *
 * Sprint 5: contadores em memória — flush futuro em `miip_estatisticas`.
 *
 * @class MiipLearningMetricsCollector
 */

class MiipLearningMetricsCollector {
  constructor() {
    /** @private */
    this._totais = {
      totalAprendizados: 0,
      aprendizadosNovos: 0,
      reutilizacoes: 0,
      associacoesReativadas: 0,
      substituicoes: 0,
      conflitos: 0,
      rejeitados: 0,
      erros: 0,
      duracaoTotalMs: 0
    };
  }

  /**
   * @param {Object} evento
   * @param {'novo'|'reutilizacao'|'reativacao'|'rejeitado'|'erro'} evento.tipo
   * @param {number} [evento.duracaoMs]
   */
  registrar(evento = {}) {
    const duracao = Number(evento.duracaoMs ?? 0);
    this._totais.duracaoTotalMs += duracao;

    switch (evento.tipo) {
      case 'novo':
        this._totais.totalAprendizados += 1;
        this._totais.aprendizadosNovos += 1;
        break;
      case 'reutilizacao':
        this._totais.totalAprendizados += 1;
        this._totais.reutilizacoes += 1;
        break;
      case 'reativacao':
        this._totais.totalAprendizados += 1;
        this._totais.associacoesReativadas += 1;
        break;
      case 'substituicao':
        this._totais.totalAprendizados += 1;
        this._totais.substituicoes = (this._totais.substituicoes ?? 0) + 1;
        break;
      case 'conflito':
        this._totais.conflitos = (this._totais.conflitos ?? 0) + 1;
        break;
      case 'erro':
        this._totais.erros += 1;
        break;
      default:
        this._totais.rejeitados += 1;
    }
  }

  /**
   * @returns {Object}
   */
  obterResumo() {
    const total = this._totais.totalAprendizados + this._totais.rejeitados + this._totais.erros;
    return {
      ...this._totais,
      totalOperacoes: total,
      tempoMedioMs: total > 0 ? this._totais.duracaoTotalMs / total : 0
    };
  }

  /**
   * @returns {void}
   */
  reiniciar() {
    this._totais = {
      totalAprendizados: 0,
      aprendizadosNovos: 0,
      reutilizacoes: 0,
      associacoesReativadas: 0,
      substituicoes: 0,
      conflitos: 0,
      rejeitados: 0,
      erros: 0,
      duracaoTotalMs: 0
    };
  }
}

const instancia = new MiipLearningMetricsCollector();

module.exports = instancia;
module.exports.MiipLearningMetricsCollector = MiipLearningMetricsCollector;
