/**
 * Engine inteligente de resolução de contratos de Web Service.
 *
 * Retorna sempre um ResolutionResult (objeto) — nunca uma string.
 *
 * Fluxo F3 / RC1.1:
 *   resolve() → validar → override? → registry → ResolutionResult
 *
 * CACHE e FALLBACK: arquitetura preparada, ainda não ativos.
 * Override de configuração (banco): ainda não ligado — apenas se passado no contexto.
 *
 * Usado pelos runtimes fiscais via FiscalWebServices.
 *
 * @module services/fiscal/core/UrlResolver
 */

const { ResolverContext } = require('./ResolverContext');
const { ResolutionResult } = require('./ResolutionResult');
const { ResolutionSource } = require('./ResolutionSource');
const { assertValidResolverContext } = require('./ResolverValidator');
const { ResolverMetrics } = require('./ResolverMetrics');
const { ResolverWarnings, createWarning } = require('./ResolverWarnings');
const { ResolverException } = require('./ResolverException');
const { createWebServiceDefinition } = require('./WebServiceDefinition');
const { isManifestacaoOperation } = require('./OperationType');
const { UF_AN } = require('./RegistryBuilder');

class UrlResolver {
  /**
   * @param {import('./WebServiceRegistry').WebServiceRegistry|null} [registry]
   * @param {object} [options]
   * @param {ResolverMetrics} [options.metrics]
   */
  constructor(registry = null, options = {}) {
    this._registry = registry;
    this._metrics = options.metrics || new ResolverMetrics();
    /** Reserva para cache futuro (F4+). */
    this._cacheEnabled = false;
    /** Reserva para fallback futuro (F4+). */
    this._fallbackEnabled = false;
  }

  /**
   * @returns {import('./WebServiceRegistry').WebServiceRegistry|null}
   */
  getRegistry() {
    return this._registry;
  }

  /**
   * @param {import('./WebServiceRegistry').WebServiceRegistry} registry
   * @returns {UrlResolver}
   */
  setRegistry(registry) {
    this._registry = registry;
    return this;
  }

  /**
   * @returns {ResolverMetrics}
   */
  getMetrics() {
    return this._metrics;
  }

  /**
   * Indica se há registry populado para consulta.
   * @returns {boolean}
   */
  isReady() {
    return Boolean(this._registry && !this._registry.isEmpty());
  }

  /**
   * Manifestação do Destinatário sempre resolve no Ambiente Nacional (NT 2020.001 §6.3).
   * @param {object} input
   * @returns {object}
   * @private
   */
  _normalizeInput(input) {
    const raw = input && typeof input === 'object' ? { ...input } : {};
    if (isManifestacaoOperation(raw.operacao)) {
      raw.uf = UF_AN;
    }
    return raw;
  }

  /**
   * Resolve o contrato completo do Web Service.
   *
   * @param {object} input
   * @param {string} input.modelo
   * @param {string} input.operacao
   * @param {string} input.ambiente
   * @param {string} input.uf
   * @param {string} [input.versao]
   * @param {object|null} [input.override]
   * @param {object} [input.metadata]
   * @returns {ResolutionResult}
   */
  resolve(input) {
    const started = process.hrtime.bigint();

    const finish = (result) => {
      this._metrics.record(result);
      return result;
    };

    const elapsedMs = () => {
      const diff = process.hrtime.bigint() - started;
      return Number(diff) / 1e6;
    };

    let context;
    try {
      context = ResolverContext.create(this._normalizeInput(input || {}));
    } catch (error) {
      const result = ResolutionResult.failure({
        executionTime: elapsedMs(),
        error: error.message,
        warnings: [],
        context: null
      });
      return finish(result);
    }

    const plainContext = {
      modelo: context.modelo,
      operacao: context.operacao,
      ambiente: context.ambiente,
      uf: context.uf,
      versao: context.versao
    };

    let validationWarnings = [];
    try {
      const validated = assertValidResolverContext(context);
      validationWarnings = validated.warnings || [];
    } catch (error) {
      const warnings = ResolverException.isResolverException(error)
        ? (error.details.warnings || [])
        : [];
      return finish(ResolutionResult.failure({
        executionTime: elapsedMs(),
        error: error.message,
        warnings,
        context: plainContext
      }));
    }

    const warnings = [...validationWarnings];

    // --- OVERRIDE (F3: só se passado explicitamente no contexto; config/banco ainda vazio) ---
    if (context.override != null) {
      const overrideResult = this._tryResolveOverride(context, warnings, elapsedMs, plainContext);
      if (overrideResult) {
        return finish(overrideResult);
      }
      warnings.push(createWarning(ResolverWarnings.OVERRIDE_NAO_ENCONTRADO));
    }

    // --- CACHE (reservado) ---
    if (this._cacheEnabled) {
      const cached = this._tryResolveCache(context);
      if (cached) {
        return finish(ResolutionResult.success({
          source: ResolutionSource.CACHE,
          definition: cached,
          warnings,
          executionTime: elapsedMs(),
          context: plainContext
        }));
      }
      warnings.push(createWarning(ResolverWarnings.CACHE_INDISPONIVEL));
    }

    // --- REGISTRY ---
    if (!this._registry) {
      return finish(ResolutionResult.failure({
        executionTime: elapsedMs(),
        error: 'WebServiceRegistry não configurado.',
        warnings,
        context: plainContext
      }));
    }

    if (this._registry.isEmpty()) {
      warnings.push(createWarning(ResolverWarnings.REGISTRY_VAZIO));
    }

    const definition = this._registry.get(context.toRegistryCriteria());

    if (definition) {
      if (definition.ativo === false) {
        warnings.push(createWarning(ResolverWarnings.SERVICO_DESATIVADO));
      }
      if (context.versao && definition.versao && context.versao !== definition.versao) {
        warnings.push(createWarning(ResolverWarnings.VERSAO_DIVERGENTE));
      }

      return finish(ResolutionResult.success({
        source: ResolutionSource.REGISTRY,
        definition,
        warnings,
        executionTime: elapsedMs(),
        context: plainContext
      }));
    }

    // --- FALLBACK (reservado) ---
    if (this._fallbackEnabled) {
      const fallback = this._tryResolveFallback(context);
      if (fallback) {
        return finish(ResolutionResult.success({
          source: ResolutionSource.FALLBACK,
          definition: fallback,
          warnings,
          executionTime: elapsedMs(),
          context: plainContext
        }));
      }
      warnings.push(createWarning(ResolverWarnings.FALLBACK_INDISPONIVEL));
    }

    return finish(ResolutionResult.failure({
      executionTime: elapsedMs(),
      error: `Contrato não encontrado no registry (${context.modelo}|${context.operacao}|${context.ambiente}|${context.uf}).`,
      warnings,
      context: plainContext
    }));
  }

  /**
   * Extrai endpoint do ResolutionResult (atalho). Preferir resolve().
   * @param {object} input
   * @returns {string|null}
   */
  resolveEndpoint(input) {
    const result = this.resolve(input);
    return result.getEndpoint();
  }

  /**
   * @private
   */
  _tryResolveOverride(context, warnings, elapsedMs, plainContext) {
    try {
      const raw = context.override;
      if (!raw || typeof raw !== 'object') {
        return null;
      }

      const definition = createWebServiceDefinition({
        modelo: raw.modelo || context.modelo,
        operacao: raw.operacao || context.operacao,
        ambiente: raw.ambiente || context.ambiente,
        uf: raw.uf || context.uf,
        endpoint: raw.endpoint,
        soapAction: raw.soapAction || '',
        namespace: raw.namespace || '',
        versao: raw.versao || context.versao || '4.00',
        timeout: raw.timeout,
        tls: raw.tls,
        retry: raw.retry,
        headers: raw.headers,
        descricao: raw.descricao || 'Override de resolução',
        ativo: raw.ativo !== false,
        observacoes: raw.observacoes || 'Override explícito no contexto (F3).'
      });

      return ResolutionResult.success({
        source: ResolutionSource.OVERRIDE,
        definition,
        warnings,
        executionTime: elapsedMs(),
        context: plainContext
      });
    } catch (_error) {
      return null;
    }
  }

  /**
   * Reserva arquitetural — cache ainda inexistente.
   * @private
   * @returns {null}
   */
  _tryResolveCache(_context) {
    return null;
  }

  /**
   * Reserva arquitetural — fallback ainda inexistente.
   * @private
   * @returns {null}
   */
  _tryResolveFallback(_context) {
    return null;
  }
}

module.exports = {
  UrlResolver
};
