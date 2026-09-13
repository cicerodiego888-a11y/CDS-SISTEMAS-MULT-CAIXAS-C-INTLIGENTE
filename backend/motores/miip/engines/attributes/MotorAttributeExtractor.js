/**
 * MotorAttributeExtractor — Engine de extração de atributos semânticos.
 *
 * Sprint 8 — Fase 2 Inteligência.
 *
 * Recebe CanonicalProduct, retorna SemanticProduct preenchido.
 * NÃO identifica produtos. NÃO acessa banco, SQL, XML ou ERP.
 * NÃO compara produtos.
 *
 * @class MotorAttributeExtractor
 * @module motores/miip/engines/attributes/MotorAttributeExtractor
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const CanonicalProduct = require('../../core/CanonicalProduct');
const SemanticProduct = require('../../core/SemanticProduct');
const SemanticMetadata = require('../../core/SemanticMetadata');
const SemanticExtractionReport = require('../../core/SemanticExtractionReport');
const AttributeParser = require('../../utils/AttributeParser');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

const MOTOR_CODIGO = 'motor_attribute_extractor';

class MotorAttributeExtractor extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   * @param {import('../../metrics/MiipMetricsCollector')} [config.metricsCollector]
   * @param {import('../../logs/MiipMotorLogService')} [config.logService]
   * @param {Object} [config.attributeConfig]
   */
  constructor(config = {}) {
    super(config);
    this._metrics = config.metricsCollector ?? metricsCollector;
    this._logs = config.logService ?? motorLogService;
    this._attributeConfig = config.attributeConfig ?? null;
    /** @private @type {SemanticProduct|null} */
    this._ultimoSemantic = null;
    /** @private @type {SemanticExtractionReport|null} */
    this._ultimoRelatorio = null;
  }

  /** @returns {string} */
  getCodigo() {
    return MOTOR_CODIGO;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Extração de atributos semânticos a partir de CanonicalProduct';
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
   * @private
   * @param {CanonicalProduct|Object} entrada
   * @returns {CanonicalProduct|null}
   */
  _resolverCanonical(entrada) {
    if (!entrada) return null;
    if (entrada instanceof CanonicalProduct) return entrada;
    if (entrada.canonico || entrada.tokens || entrada.normalizedTokens) {
      return CanonicalProduct.create(entrada);
    }
    return null;
  }

  /**
   * Monta SemanticProduct a partir de CanonicalProduct e atributos extraídos.
   *
   * @private
   * @param {CanonicalProduct} canonical
   * @param {Object<string, import('../../core/SemanticAttribute')>} atributosMap
   * @returns {SemanticProduct}
   */
  _montarSemanticProduct(canonical, atributosMap) {
    const dados = {
      original: canonical.original,
      canonico: canonical.canonico,
      tokens: canonical.tokens,
      normalizedTokens: canonical.normalizedTokens,
      atributosExtras: Object.values(atributosMap),
      metadata: SemanticMetadata.create({
        versao: SemanticProduct.VERSAO_PADRAO,
        engine: MOTOR_CODIGO,
        origem: 'canonical',
        timestamp: new Date().toISOString()
      })
    };

    Object.entries(atributosMap).forEach(([campo, attr]) => {
      dados[campo] = attr.valor;
    });

    return SemanticProduct.create(dados);
  }

  /**
   * @private
   * @param {Object<string, import('../../core/SemanticAttribute')>} atributosMap
   * @param {number} tempoProcessamento
   * @returns {SemanticExtractionReport}
   */
  _montarRelatorio(atributosMap, tempoProcessamento) {
    const encontrados = Object.keys(atributosMap);
    const naoEncontrados = AttributeParser.CAMPOS_ALVO.filter(
      (campo) => !encontrados.includes(campo)
    );

    const confiancas = Object.values(atributosMap)
      .map((attr) => attr.confianca)
      .filter((valor) => typeof valor === 'number');

    const confiancaMedia = confiancas.length > 0
      ? Math.round(confiancas.reduce((acc, val) => acc + val, 0) / confiancas.length)
      : null;

    return SemanticExtractionReport.create({
      atributosEncontrados: encontrados,
      atributosNaoEncontrados: naoEncontrados,
      tempoProcessamento,
      confiancaMedia
    });
  }

  /**
   * Extrai atributos de um CanonicalProduct.
   *
   * @param {CanonicalProduct|Object} canonicalProduct
   * @returns {{ produto: SemanticProduct, relatorio: SemanticExtractionReport }}
   */
  extrair(canonicalProduct) {
    const inicio = Date.now();
    const canonical = this._resolverCanonical(canonicalProduct);

    if (!canonical || !canonical.canonico) {
      const vazio = SemanticProduct.create({
        original: canonical?.original ?? null,
        metadata: SemanticMetadata.create({ engine: MOTOR_CODIGO })
      });
      const relatorio = SemanticExtractionReport.create({
        tempoProcessamento: Date.now() - inicio
      });
      this._ultimoSemantic = vazio;
      this._ultimoRelatorio = relatorio;
      return { produto: vazio, relatorio };
    }

    const atributosMap = AttributeParser.extrairAtributos(canonical, {
      config: this._attributeConfig ?? undefined
    });
    const tempoProcessamento = Date.now() - inicio;
    const produto = this._montarSemanticProduct(canonical, atributosMap);
    const relatorio = this._montarRelatorio(atributosMap, tempoProcessamento);

    this._ultimoSemantic = produto;
    this._ultimoRelatorio = relatorio;

    return { produto, relatorio };
  }

  /**
   * @returns {SemanticProduct|null}
   */
  obterUltimoSemantic() {
    return this._ultimoSemantic;
  }

  /**
   * @returns {SemanticExtractionReport|null}
   */
  obterUltimoRelatorio() {
    return this._ultimoRelatorio;
  }

  /**
   * Implementação IMotorIdentificacao — sempre retorna array vazio.
   * A extração fica disponível via `extrair()` / `obterUltimoSemantic()`.
   *
   * @param {Object|CanonicalProduct} item
   * @param {import('../../core/MiipContext')} [_contexto]
   * @returns {Promise<[]>}
   */
  async identificar(item, _contexto) {
    const inicio = Date.now();

    try {
      const canonical = this._resolverCanonical(item);

      if (!canonical) {
        this._ultimoSemantic = null;
        this._ultimoRelatorio = null;
        return [];
      }

      const { produto, relatorio } = this.extrair(canonical);

      this._metrics.registrarExecucao({
        motor: MOTOR_CODIGO,
        encontrado: false,
        duracaoMs: Date.now() - inicio
      });

      this._logs.registrar({
        motor: MOTOR_CODIGO,
        evento: 'attribute_extraido',
        canonico: produto.canonico?.slice(0, 120) ?? null,
        atributosEncontrados: relatorio.atributosEncontrados.length,
        confiancaMedia: relatorio.confiancaMedia,
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
        evento: 'attribute_erro',
        erro: error?.message ?? 'erro_desconhecido',
        duracaoMs: Date.now() - inicio
      });

      return [];
    }
  }
}

module.exports = MotorAttributeExtractor;
module.exports.MOTOR_CODIGO = MOTOR_CODIGO;
