/**
 * MiipResult — Resultado consolidado de uma identificação.
 *
 * Objeto de valor que agrupa decisão, score, candidatos e metadados
 * de auditoria da execução. Produzido pelo MiipOrchestrator.
 *
 * Sprint 1.1: campos de auditoria adicionados — sem montagem automática.
 *
 * @class MiipResult
 */

const MiipScore = require('./MiipScore');

const VERSAO_PADRAO = '1.1.0';

class MiipResult {
  /**
   * @param {Object} [dados]
   * @param {import('../contracts/DecisaoIdentificacaoDTO')|Object|null} [dados.decisao]
   * @param {MiipScore|Object|null} [dados.score]
   * @param {import('../contracts/ProdutoCandidatoDTO')[]|import('./MiipCandidate')[]|Object[]} [dados.candidatos]
   * @param {string[]} [dados.enginesExecutados]
   * @param {number} [dados.duracaoTotalMs] - Legado — alias de durationMs
   * @param {number} [dados.executionTime] - Tempo total de execução (ms)
   * @param {number} [dados.engineCount] - Quantidade de engines executados
   * @param {boolean} [dados.cacheHit] - Indica se resultado veio do cache
   * @param {string|null} [dados.requestId] - Identificador único da requisição
   * @param {string} [dados.version] - Versão do contrato MiipResult
   * @param {string|null} [dados.startedAt] - ISO 8601 início da execução
   * @param {string|null} [dados.finishedAt] - ISO 8601 fim da execução
   * @param {number} [dados.durationMs] - Duração do pipeline (ms)
   */
  constructor(dados = {}) {
    this.decisao = dados.decisao ?? null;
    this.score = dados.score instanceof MiipScore
      ? dados.score
      : new MiipScore(dados.score || {});
    this.candidatos = Array.isArray(dados.candidatos) ? [...dados.candidatos] : [];
    this.enginesExecutados = Array.isArray(dados.enginesExecutados)
      ? [...dados.enginesExecutados]
      : [];

    const durationMs = Number(
      dados.durationMs ?? dados.duracaoTotalMs ?? dados.executionTime ?? 0
    );

    this.durationMs = durationMs;
    this.duracaoTotalMs = durationMs;
    this.executionTime = Number(dados.executionTime ?? durationMs);
    this.engineCount = Number(
      dados.engineCount ?? this.enginesExecutados.length
    );
    this.cacheHit = Boolean(dados.cacheHit ?? false);
    this.requestId = dados.requestId ?? null;
    this.version = dados.version ?? VERSAO_PADRAO;
    this.startedAt = dados.startedAt ?? null;
    this.finishedAt = dados.finishedAt ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {MiipResult}
   */
  static create(dados = {}) {
    return new MiipResult(dados);
  }

  /**
   * Cria resultado vazio (pipeline sem candidatos).
   *
   * @param {Object} [opcoes]
   * @returns {MiipResult}
   */
  static vazio(opcoes = {}) {
    const agora = new Date().toISOString();

    return new MiipResult({
      decisao: null,
      score: MiipScore.vazio(),
      candidatos: [],
      enginesExecutados: [],
      durationMs: 0,
      executionTime: 0,
      engineCount: 0,
      cacheHit: false,
      requestId: opcoes.requestId ?? null,
      version: opcoes.version ?? VERSAO_PADRAO,
      startedAt: opcoes.startedAt ?? agora,
      finishedAt: opcoes.finishedAt ?? agora
    });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      decisao: this.decisao,
      score: this.score.toJSON(),
      candidatos: this.candidatos,
      enginesExecutados: this.enginesExecutados,
      duracaoTotalMs: this.duracaoTotalMs,
      executionTime: this.executionTime,
      engineCount: this.engineCount,
      cacheHit: this.cacheHit,
      requestId: this.requestId,
      version: this.version,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      durationMs: this.durationMs
    };
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipResult}
   */
  static fromJSON(plain) {
    if (!plain) return MiipResult.vazio();

    return new MiipResult({
      decisao: plain.decisao ?? null,
      score: MiipScore.fromJSON(plain.score),
      candidatos: plain.candidatos ?? [],
      enginesExecutados: plain.enginesExecutados ?? [],
      duracaoTotalMs: plain.duracaoTotalMs ?? plain.durationMs ?? 0,
      executionTime: plain.executionTime ?? plain.durationMs ?? plain.duracaoTotalMs ?? 0,
      engineCount: plain.engineCount ?? (plain.enginesExecutados?.length ?? 0),
      cacheHit: plain.cacheHit ?? false,
      requestId: plain.requestId ?? null,
      version: plain.version ?? VERSAO_PADRAO,
      startedAt: plain.startedAt ?? null,
      finishedAt: plain.finishedAt ?? null,
      durationMs: plain.durationMs ?? plain.duracaoTotalMs ?? 0
    });
  }
}

MiipResult.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = MiipResult;
