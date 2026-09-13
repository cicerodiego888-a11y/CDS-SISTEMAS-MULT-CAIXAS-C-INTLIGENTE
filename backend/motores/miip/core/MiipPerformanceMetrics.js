/**
 * MiipPerformanceMetrics — Métricas agregadas de performance do MIIP.
 *
 * Sprint 14 — Observabilidade e Telemetria.
 *
 * @class MiipPerformanceMetrics
 */

const VERSAO_PADRAO = '1.0.0';

class MiipPerformanceMetrics {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.tempoMedio]
   * @param {number} [dados.tempoMaximo]
   * @param {number} [dados.tempoMinimo]
   * @param {number} [dados.totalExecucoes]
   * @param {Object} [dados.tempoPorEngine]
   */
  constructor(dados = {}) {
    this.tempoMedio = dados.tempoMedio ?? 0;
    this.tempoMaximo = dados.tempoMaximo ?? 0;
    this.tempoMinimo = dados.tempoMinimo ?? 0;
    this.totalExecucoes = dados.totalExecucoes ?? 0;
    this.tempoPorEngine = dados.tempoPorEngine ?? {};
  }

  /**
   * @param {Object} [dados]
   * @returns {MiipPerformanceMetrics}
   */
  static create(dados = {}) {
    return new MiipPerformanceMetrics(dados);
  }

  /**
   * @param {Object[]} execucoes
   * @returns {MiipPerformanceMetrics}
   */
  static calcular(execucoes = []) {
    if (!execucoes.length) {
      return new MiipPerformanceMetrics();
    }

    const tempos = execucoes.map((e) => Number(e.tempoTotal ?? e.duracaoMs ?? 0));
    const tempoPorEngine = {};

    execucoes.forEach((exec) => {
      Object.entries(exec.tempoPorEngine ?? {}).forEach(([motor, tempo]) => {
        if (!tempoPorEngine[motor]) {
          tempoPorEngine[motor] = { total: 0, count: 0, max: 0, min: null };
        }
        const bucket = tempoPorEngine[motor];
        const ms = Number(tempo);
        bucket.total += ms;
        bucket.count += 1;
        bucket.max = Math.max(bucket.max, ms);
        bucket.min = bucket.min == null ? ms : Math.min(bucket.min, ms);
      });
    });

    const tempoPorEngineMedio = {};
    Object.entries(tempoPorEngine).forEach(([motor, bucket]) => {
      tempoPorEngineMedio[motor] = {
        tempoMedio: bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0,
        tempoMaximo: bucket.max,
        tempoMinimo: bucket.min ?? 0,
        totalExecucoes: bucket.count
      };
    });

    return new MiipPerformanceMetrics({
      tempoMedio: Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length),
      tempoMaximo: Math.max(...tempos),
      tempoMinimo: Math.min(...tempos),
      totalExecucoes: execucoes.length,
      tempoPorEngine: tempoPorEngineMedio
    });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      tempoMedio: this.tempoMedio,
      tempoMaximo: this.tempoMaximo,
      tempoMinimo: this.tempoMinimo,
      totalExecucoes: this.totalExecucoes,
      tempoPorEngine: this.tempoPorEngine
    };
  }
}

MiipPerformanceMetrics.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = MiipPerformanceMetrics;
