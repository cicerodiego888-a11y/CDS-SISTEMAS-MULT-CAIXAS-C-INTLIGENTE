/**
 * MiipMetricsCollector — Coleta de métricas operacionais dos motores MIIP.
 *
 * Armazena contadores em memória por motor (volume, latência, acertos).
 * Sprint 3: coleta local — flush para `miip_estatisticas` em sprint futura.
 *
 * @class MiipMetricsCollector
 */

class MiipMetricsCollector {
  constructor() {
    /** @private @type {Map<string, Object>} */
    this._porMotor = new Map();
  }

  /**
   * Inicializa ou retorna bucket de métricas de um motor.
   *
   * @private
   * @param {string} motorCodigo
   * @returns {Object}
   */
  _obterBucket(motorCodigo) {
    const codigo = String(motorCodigo || 'desconhecido');

    if (!this._porMotor.has(codigo)) {
      this._porMotor.set(codigo, {
        motor: codigo,
        totalConsultas: 0,
        totalEncontrados: 0,
        totalNaoEncontrados: 0,
        totalErros: 0,
        duracaoTotalMs: 0,
        duracaoMinMs: null,
        duracaoMaxMs: 0
      });
    }

    return this._porMotor.get(codigo);
  }

  /**
   * Registra execução de um motor.
   *
   * @param {Object} evento
   * @param {string} evento.motor - Código do motor
   * @param {number} [evento.duracaoMs] - Duração da execução
   * @param {boolean} [evento.encontrado] - Se localizou candidato
   * @param {boolean} [evento.erro] - Se houve falha
   * @returns {void}
   */
  registrarExecucao(evento = {}) {
    const bucket = this._obterBucket(evento.motor);
    const duracao = Number(evento.duracaoMs ?? 0);

    bucket.totalConsultas += 1;
    bucket.duracaoTotalMs += duracao;
    bucket.duracaoMaxMs = Math.max(bucket.duracaoMaxMs, duracao);

    if (bucket.duracaoMinMs == null || duracao < bucket.duracaoMinMs) {
      bucket.duracaoMinMs = duracao;
    }

    if (evento.erro) {
      bucket.totalErros += 1;
      return;
    }

    if (evento.encontrado) {
      bucket.totalEncontrados += 1;
    } else {
      bucket.totalNaoEncontrados += 1;
    }
  }

  /**
   * Registra operação de aprendizado (gravação confirmada pelo usuário).
   *
   * @param {Object} evento
   * @param {string} [evento.motor] - Código do motor (default motor_aprendizado)
   * @param {number} [evento.duracaoMs]
   * @param {boolean} [evento.gravado]
   * @param {boolean} [evento.rejeitado]
   * @param {boolean} [evento.substituiu]
   * @param {boolean} [evento.erro]
   * @returns {void}
   */
  registrarAprendizado(evento = {}) {
    const bucket = this._obterBucket(evento.motor ?? 'motor_aprendizado');
    const duracao = Number(evento.duracaoMs ?? 0);

    bucket.totalConsultas += 1;
    bucket.duracaoTotalMs += duracao;
    bucket.duracaoMaxMs = Math.max(bucket.duracaoMaxMs, duracao);

    if (bucket.duracaoMinMs == null || duracao < bucket.duracaoMinMs) {
      bucket.duracaoMinMs = duracao;
    }

    if (evento.erro) {
      bucket.totalErros += 1;
      return;
    }

    if (evento.gravado || evento.substituiu) {
      bucket.totalEncontrados += 1;
    } else if (evento.rejeitado) {
      bucket.totalNaoEncontrados += 1;
    } else {
      bucket.totalNaoEncontrados += 1;
    }
  }

  /**
   *
   * @param {string} motorCodigo
   * @returns {Object|null}
   */
  obterPorMotor(motorCodigo) {
    const bucket = this._porMotor.get(String(motorCodigo));
    if (!bucket) return null;

    return {
      ...bucket,
      tempoMedioMs: bucket.totalConsultas > 0
        ? bucket.duracaoTotalMs / bucket.totalConsultas
        : 0,
      taxaEncontro: bucket.totalConsultas > 0
        ? bucket.totalEncontrados / bucket.totalConsultas
        : 0,
      taxaErro: bucket.totalConsultas > 0
        ? bucket.totalErros / bucket.totalConsultas
        : 0
    };
  }

  /**
   * Retorna resumo consolidado de todos os motores.
   *
   * @returns {Object}
   */
  obterResumo() {
    const motores = [...this._porMotor.keys()].map((codigo) => this.obterPorMotor(codigo));

    const totalConsultas = motores.reduce((acc, m) => acc + m.totalConsultas, 0);
    const totalEncontrados = motores.reduce((acc, m) => acc + m.totalEncontrados, 0);
    const totalErros = motores.reduce((acc, m) => acc + m.totalErros, 0);
    const duracaoTotalMs = motores.reduce((acc, m) => acc + m.duracaoTotalMs, 0);

    return {
      totalMotores: motores.length,
      totalConsultas,
      totalEncontrados,
      totalNaoEncontrados: motores.reduce((acc, m) => acc + m.totalNaoEncontrados, 0),
      totalErros,
      tempoMedioMs: totalConsultas > 0 ? duracaoTotalMs / totalConsultas : 0,
      taxaEncontro: totalConsultas > 0 ? totalEncontrados / totalConsultas : 0,
      taxaErro: totalConsultas > 0 ? totalErros / totalConsultas : 0,
      motores
    };
  }

  /**
   * Limpa métricas (apenas testes).
   *
   * @returns {void}
   */
  reiniciar() {
    this._porMotor.clear();
  }
}

const instancia = new MiipMetricsCollector();

module.exports = instancia;
module.exports.MiipMetricsCollector = MiipMetricsCollector;
