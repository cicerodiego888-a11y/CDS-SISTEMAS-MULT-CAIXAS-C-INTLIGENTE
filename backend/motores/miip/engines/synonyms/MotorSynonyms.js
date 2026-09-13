/**
 * MotorSynonyms — Engine de enriquecimento semântico por sinônimos.
 *
 * Sprint 9 — Fase 2 Inteligência.
 *
 * Recebe SemanticProduct e retorna SemanticProduct enriquecido.
 * NÃO identifica produtos. NÃO acessa banco, SQL, XML ou ERP.
 * NÃO compara produtos.
 *
 * @class MotorSynonyms
 * @module motores/miip/engines/synonyms/MotorSynonyms
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const SemanticProduct = require('../../core/SemanticProduct');
const SynonymMatch = require('../../core/SynonymMatch');
const SynonymReport = require('../../core/SynonymReport');
const SynonymDictionary = require('../../utils/SynonymDictionary');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

const MOTOR_CODIGO = 'motor_synonyms';

class MotorSynonyms extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   * @param {import('../../metrics/MiipMetricsCollector')} [config.metricsCollector]
   * @param {import('../../logs/MiipMotorLogService')} [config.logService]
   * @param {string} [config.synonymDir]
   */
  constructor(config = {}) {
    super(config);
    this._metrics = config.metricsCollector ?? metricsCollector;
    this._logs = config.logService ?? motorLogService;
    this._synonymDir = config.synonymDir ?? null;
    /** @private @type {SemanticProduct|null} */
    this._ultimoSemantic = null;
    /** @private @type {SynonymReport|null} */
    this._ultimoRelatorio = null;
  }

  /** @returns {string} */
  getCodigo() {
    return MOTOR_CODIGO;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Enriquecimento semântico por sinônimos conhecidos';
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
    if (entrada.canonico || entrada.tokens || entrada.normalizedTokens) {
      return SemanticProduct.create(entrada);
    }
    return null;
  }

  /**
   * @private
   * @param {SemanticProduct} produto
   * @returns {string[]}
   */
  _coletarTermos(produto) {
    const termos = [];
    const tokensBase = [];

    if (Array.isArray(produto.tokens)) {
      termos.push(...produto.tokens);
      tokensBase.push(...produto.tokens);
    }

    if (Array.isArray(produto.normalizedTokens)) {
      produto.normalizedTokens.forEach((token) => {
        termos.push(token.textoOriginal, token.textoCanonico, token.normalizado);
        tokensBase.push(token.textoCanonico);
      });
    }

    [
      produto.tipo,
      produto.categoria,
      produto.subcategoria,
      produto.marca,
      produto.modelo,
      produto.linha,
      produto.familia,
      produto.tecnologia,
      produto.cor,
      produto.material,
      produto.acabamento,
      produto.embalagem,
      produto.unidadeMedida
    ].filter(Boolean).forEach((valor) => termos.push(valor));

    if (Array.isArray(produto.atributosExtras)) {
      produto.atributosExtras.forEach((attr) => {
        termos.push(attr.valor, attr.normalizado);
      });
    }

    if (produto.canonico) {
      const tokensCanonicos = String(produto.canonico).split(/\s+/).filter(Boolean);
      termos.push(...tokensCanonicos);
      tokensBase.push(...tokensCanonicos);
    }

    const tokensNormalizados = tokensBase
      .filter(Boolean)
      .map(SynonymDictionary.normalizarChave);

    tokensNormalizados.forEach((token, indice) => {
      const proximo = tokensNormalizados[indice + 1];
      const terceiro = tokensNormalizados[indice + 2];
      if (proximo) termos.push(`${token} ${proximo}`);
      if (proximo && terceiro) termos.push(`${token} ${proximo} ${terceiro}`);
    });

    return [...new Set(termos.filter(Boolean).map(SynonymDictionary.normalizarChave))];
  }

  /**
   * @private
   * @param {SynonymMatch[]} matches
   * @returns {{ synonyms: SynonymMatch[], relatedTokens: string[], semanticAliases: string[] }}
   */
  _montarEnriquecimento(matches) {
    const chaveUnica = new Set();
    const synonyms = [];
    const relatedTokens = [];
    const semanticAliases = [];

    matches.forEach((match) => {
      const chave = `${match.original}|${match.sinonimo}|${match.categoria}`;
      if (chaveUnica.has(chave)) return;
      chaveUnica.add(chave);
      synonyms.push(match);
      relatedTokens.push(match.sinonimo);
      semanticAliases.push(`${match.original}=${match.sinonimo}`);
    });

    return {
      synonyms,
      relatedTokens: [...new Set(relatedTokens)],
      semanticAliases: [...new Set(semanticAliases)]
    };
  }

  /**
   * Enriquece um SemanticProduct com sinônimos conhecidos.
   *
   * @param {SemanticProduct|Object} semanticProduct
   * @returns {{ produto: SemanticProduct, relatorio: SynonymReport }}
   */
  enriquecer(semanticProduct) {
    const inicio = Date.now();
    const semantic = this._resolverSemantic(semanticProduct);

    if (!semantic) {
      const produto = SemanticProduct.create();
      const relatorio = SynonymReport.create({ tempo: Date.now() - inicio });
      this._ultimoSemantic = produto;
      this._ultimoRelatorio = relatorio;
      return { produto, relatorio };
    }

    const termos = this._coletarTermos(semantic);
    const matches = termos.flatMap((termo) => SynonymDictionary.buscar(termo, {
      diretorio: this._synonymDir ?? undefined
    }));
    const enriquecimento = this._montarEnriquecimento(matches);

    const produto = SemanticProduct.create({
      ...semantic.toJSON(),
      synonyms: enriquecimento.synonyms,
      relatedTokens: [
        ...(Array.isArray(semantic.relatedTokens) ? semantic.relatedTokens : []),
        ...enriquecimento.relatedTokens
      ].filter(Boolean),
      semanticAliases: [
        ...(Array.isArray(semantic.semanticAliases) ? semantic.semanticAliases : []),
        ...enriquecimento.semanticAliases
      ].filter(Boolean)
    });

    produto.relatedTokens = [...new Set(produto.relatedTokens ?? [])];
    produto.semanticAliases = [...new Set(produto.semanticAliases ?? [])];

    const categoriasUtilizadas = [...new Set(enriquecimento.synonyms.map((match) => match.categoria))];
    const relatorio = SynonymReport.create({
      quantidadeSinonimosEncontrados: enriquecimento.synonyms.length,
      tempo: Date.now() - inicio,
      categoriasUtilizadas
    });

    this._ultimoSemantic = produto;
    this._ultimoRelatorio = relatorio;

    return { produto, relatorio };
  }

  /** @returns {SemanticProduct|null} */
  obterUltimoSemantic() {
    return this._ultimoSemantic;
  }

  /** @returns {SynonymReport|null} */
  obterUltimoRelatorio() {
    return this._ultimoRelatorio;
  }

  /**
   * Implementação IMotorIdentificacao — sempre retorna array vazio.
   * O enriquecimento fica disponível via `enriquecer()`.
   *
   * @param {Object|SemanticProduct} item
   * @param {import('../../core/MiipContext')} [_contexto]
   * @returns {Promise<[]>}
   */
  async identificar(item, _contexto) {
    const inicio = Date.now();

    try {
      const semantic = this._resolverSemantic(item);

      if (!semantic) {
        this._ultimoSemantic = null;
        this._ultimoRelatorio = null;
        return [];
      }

      const { produto, relatorio } = this.enriquecer(semantic);

      this._metrics.registrarExecucao({
        motor: MOTOR_CODIGO,
        encontrado: false,
        duracaoMs: Date.now() - inicio
      });

      this._logs.registrar({
        motor: MOTOR_CODIGO,
        evento: 'synonyms_enriquecido',
        canonico: produto.canonico?.slice(0, 120) ?? null,
        sinonimosEncontrados: relatorio.quantidadeSinonimosEncontrados,
        categoriasUtilizadas: relatorio.categoriasUtilizadas,
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
        evento: 'synonyms_erro',
        erro: error?.message ?? 'erro_desconhecido',
        duracaoMs: Date.now() - inicio
      });

      return [];
    }
  }
}

module.exports = MotorSynonyms;
module.exports.MOTOR_CODIGO = MOTOR_CODIGO;
