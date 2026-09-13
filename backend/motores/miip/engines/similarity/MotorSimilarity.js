/**
 * MotorSimilarity — Engine de similaridade híbrida entre SemanticProduct.
 *
 * Sprint 10 — Fase 2 Inteligência.
 *
 * Compara dois SemanticProduct por atributos estruturados.
 * NÃO identifica produtos. NÃO acessa banco, SQL, XML ou ERP.
 * NÃO toma decisão nem cria associação.
 *
 * @class MotorSimilarity
 * @module motores/miip/engines/similarity/MotorSimilarity
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const SemanticProduct = require('../../core/SemanticProduct');
const SimilarityResult = require('../../core/SimilarityResult');
const SimilarityComparator = require('../../utils/SimilarityComparator');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

const MOTOR_CODIGO = 'motor_similarity';

class MotorSimilarity extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   * @param {import('../../metrics/MiipMetricsCollector')} [config.metricsCollector]
   * @param {import('../../logs/MiipMotorLogService')} [config.logService]
   * @param {Object} [config.pesos]
   * @param {Object} [config.confianca]
   */
  constructor(config = {}) {
    super(config);
    this._metrics = config.metricsCollector ?? metricsCollector;
    this._logs = config.logService ?? motorLogService;
    this._pesos = config.pesos ?? null;
    this._confianca = config.confianca ?? null;
    /** @private @type {SimilarityResult|null} */
    this._ultimoResultado = null;
  }

  /** @returns {string} */
  getCodigo() {
    return MOTOR_CODIGO;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Similaridade híbrida entre SemanticProduct por atributos estruturados';
  }

  /** @returns {number} */
  getPeso() {
    return 0;
  }

  /**
   * @private
   * @param {SemanticProduct|Object} entrada
   * @returns {SemanticProduct|null}
   */
  _resolverSemantic(entrada) {
    if (!entrada) return null;
    if (entrada instanceof SemanticProduct) return entrada;
    if (entrada.canonico || entrada.tokens || entrada.marca || entrada.tipo) {
      return SemanticProduct.create(entrada);
    }
    return null;
  }

  /**
   * Compara dois SemanticProduct.
   *
   * @param {SemanticProduct|Object} produtoA
   * @param {SemanticProduct|Object} produtoB
   * @returns {SimilarityResult}
   */
  comparar(produtoA, produtoB) {
    const a = this._resolverSemantic(produtoA);
    const b = this._resolverSemantic(produtoB);

    if (!a || !b) {
      const vazio = SimilarityResult.create({
        score: 0,
        confidence: 'NENHUMA',
        explicacao: { linhas: ['Produto semântico inválido para comparação.'] }
      });
      this._ultimoResultado = vazio;
      return vazio;
    }

    const resultado = SimilarityComparator.comparar(a, b, {
      pesos: this._pesos ?? undefined,
      confianca: this._confianca ?? undefined
    });

    this._ultimoResultado = resultado;
    return resultado;
  }

  /**
   * @returns {SimilarityResult|null}
   */
  obterUltimoResultado() {
    return this._ultimoResultado;
  }

  /**
   * Implementação IMotorIdentificacao — sempre retorna array vazio.
   * A comparação fica disponível via `comparar()`.
   *
   * @param {Object} item
   * @param {import('../../core/MiipContext')} [_contexto]
   * @returns {Promise<[]>}
   */
  async identificar(item, _contexto) {
    const inicio = Date.now();

    try {
      const produtoA = this._resolverSemantic(item?.produtoA ?? item?.semanticA ?? item);
      const produtoB = this._resolverSemantic(item?.produtoB ?? item?.semanticB);

      if (!produtoA || !produtoB) {
        this._ultimoResultado = null;
        return [];
      }

      const resultado = this.comparar(produtoA, produtoB);

      this._metrics.registrarExecucao({
        motor: MOTOR_CODIGO,
        encontrado: false,
        duracaoMs: Date.now() - inicio
      });

      this._logs.registrar({
        motor: MOTOR_CODIGO,
        evento: 'similarity_comparado',
        score: resultado.score,
        confidence: resultado.confidence,
        atributosComparados: resultado.estatisticas.quantidadeAtributosComparados,
        duracaoMs: Date.now() - inicio
      });

      return [];
    } catch (error) {
      this._metrics.registrarExecucao({
        motor: MOTOR_CODIGO,
        erro: true,
        duracaoMs: Date.now() - inicio
      });

      this._logs.registrar({
        motor: MOTOR_CODIGO,
        evento: 'similarity_erro',
        erro: error?.message ?? 'erro_desconhecido',
        duracaoMs: Date.now() - inicio
      });

      return [];
    }
  }
}

module.exports = MotorSimilarity;
module.exports.MOTOR_CODIGO = MOTOR_CODIGO;
