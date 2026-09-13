/**
 * MotorCanonical — Engine de padronização canônica de descrições textuais.
 *
 * Sprint 7 — Fase 2 Inteligência.
 *
 * NÃO identifica produtos. NÃO acessa banco, SQL, fornecedor, XML ou ERP.
 * Trabalha exclusivamente com texto (produtoNome / string).
 *
 * @class MotorCanonical
 * @module motores/miip/engines/canonical/MotorCanonical
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const CanonicalProduct = require('../../core/CanonicalProduct');
const { normalizar } = require('../../utils/CanonicalNormalizer');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

const MOTOR_CODIGO = 'motor_canonical';

class MotorCanonical extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   * @param {import('../../metrics/MiipMetricsCollector')} [config.metricsCollector]
   * @param {import('../../logs/MiipMotorLogService')} [config.logService]
   * @param {Object} [config.dicionario]
   */
  constructor(config = {}) {
    super(config);
    this._metrics = config.metricsCollector ?? metricsCollector;
    this._logs = config.logService ?? motorLogService;
    this._dicionario = config.dicionario ?? null;
    /** @private @type {CanonicalProduct|null} */
    this._ultimoCanonical = null;
  }

  /** @returns {string} */
  getCodigo() {
    return MOTOR_CODIGO;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Padronização canônica de descrições textuais (sem identificação)';
  }

  /**
   * Peso zero — não participa de score de identificação.
   *
   * @returns {number}
   */
  getPeso() {
    return 0;
  }

  /**
   * Extrai texto puro do item — ignora demais campos.
   *
   * @private
   * @param {Object|string} entrada
   * @returns {string}
   */
  _extrairTexto(entrada) {
    if (typeof entrada === 'string') return entrada;
    if (!entrada || typeof entrada !== 'object') return '';

    return String(
      entrada.produtoNome
      ?? entrada.produto_nome
      ?? entrada.texto
      ?? entrada.descricao
      ?? ''
    ).trim();
  }

  /**
   * Transforma texto em representação canônica.
   *
   * @param {string} texto
   * @returns {CanonicalProduct}
   */
  canonicalizar(texto) {
    const resultado = normalizar(texto, {
      dicionario: this._dicionario ?? undefined
    });
    this._ultimoCanonical = resultado;
    return resultado;
  }

  /**
   * @returns {CanonicalProduct|null}
   */
  obterUltimoCanonical() {
    return this._ultimoCanonical;
  }

  /**
   * Implementação IMotorIdentificacao — sempre retorna array vazio.
   * A canonicalização fica disponível via `canonicalizar()` / `obterUltimoCanonical()`.
   *
   * @param {Object|string} item
   * @param {import('../../core/MiipContext')} [_contexto]
   * @returns {Promise<[]>}
   */
  async identificar(item, _contexto) {
    const inicio = Date.now();
    const texto = this._extrairTexto(item);

    try {
      if (!texto) {
        this._ultimoCanonical = null;
        return [];
      }

      this.canonicalizar(texto);

      this._metrics.registrarExecucao({
        motor: MOTOR_CODIGO,
        encontrado: false,
        duracaoMs: Date.now() - inicio
      });

      this._logs.registrar({
        motor: MOTOR_CODIGO,
        evento: 'canonical_processado',
        textoEntrada: texto.slice(0, 120),
        canonico: this._ultimoCanonical?.canonico ?? null,
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
        evento: 'canonical_erro',
        erro: error?.message ?? 'erro_desconhecido',
        duracaoMs: Date.now() - inicio
      });

      return [];
    }
  }
}

module.exports = MotorCanonical;
module.exports.MOTOR_CODIGO = MOTOR_CODIGO;
