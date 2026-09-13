/**
 * Camada Enterprise de transporte SOAP para a SEFAZ.
 *
 * Plataforma Fiscal RC1 (F1–F10) + consolidação RC1.1.
 * Enablement por operação via TransportEnablement.
 * Retry com backoff exponencial (RetryPolicy).
 *
 * @module services/fiscal/core/SoapTransport
 */

const axios = require('axios');
const https = require('https');
const { RetryPolicy } = require('./RetryPolicy');
const { TimeoutPolicy, DEFAULT_TIMEOUT_MS } = require('./TimeoutPolicy');
const { TlsPolicy } = require('./TlsPolicy');
const { TransportMetrics } = require('./TransportMetrics');
const { TransportFactory } = require('./TransportFactory');
const { TransportRequest } = require('./TransportRequest');
const { TransportResponse } = require('./TransportResponse');
const { TransportException } = require('./TransportException');
const { isTransportEnabledFor, ENABLED_OPERATIONS } = require('./TransportEnablement');
const { OperationType } = require('./OperationType');
const { fiscalSoapTelemetry } = require('./FiscalSoapTelemetry');

const DEFAULT_MAX_RETRIES = 2;
const PLATFORM_USER_AGENT = 'CDGESTAO-FISCAL-PLATFORM/RC1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Evita expor HTML IIS ("Requested URL: /path") sem o host completo.
 * @param {{ url: string, statusCode: number|null, rawBody: *, fallback?: string }} params
 * @returns {string}
 */
function formatSoapHttpError({ url, statusCode, rawBody, fallback }) {
  const statusPart = statusCode ? `HTTP ${statusCode}` : 'Erro HTTP';
  const urlPart = url ? ` em ${url}` : '';
  let detail = '';

  if (typeof rawBody === 'string' && rawBody.trim()) {
    const compact = rawBody.replace(/\s+/g, ' ').trim();
    if (/Requested URL/i.test(compact) || /<!DOCTYPE|<html/i.test(compact)) {
      detail = ' — resposta HTML da SEFAZ/proxy (endpoint ou rota inválida).';
    } else if (compact.length <= 240) {
      detail = `: ${compact}`;
    } else {
      detail = `: ${compact.slice(0, 240)}…`;
    }
  } else if (fallback) {
    detail = `: ${fallback}`;
  }

  return `${statusPart}${urlPart}${detail}`;
}

class SoapTransport {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.maxRetries]
   * @param {string} [options.minTlsVersion]
   * @param {boolean} [options.rejectUnauthorized]
   * @param {boolean} [options.skipBackoff] Desliga espera entre retries (testes)
   * @param {RetryPolicy} [options.retryPolicy]
   * @param {TimeoutPolicy} [options.timeoutPolicy]
   * @param {TlsPolicy} [options.tlsPolicy]
   * @param {TransportMetrics} [options.metrics]
   * @param {TransportFactory} [options.factory]
   * @param {Function} [options.httpClient] Injeção para testes — sem HTTP real
   * @param {Function} [options.createHttpsAgent] Injeção de agente TLS
   */
  constructor(options = {}) {
    this.timeoutPolicy = options.timeoutPolicy
      || new TimeoutPolicy({ defaultTimeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
    this.retryPolicy = options.retryPolicy
      || new RetryPolicy({
        maxAttempts: Number(options.maxRetries) >= 0
          ? Number(options.maxRetries)
          : DEFAULT_MAX_RETRIES
      });
    this.tlsPolicy = options.tlsPolicy
      || new TlsPolicy({
        minVersion: options.minTlsVersion || 'TLSv1.2',
        rejectUnauthorized: options.rejectUnauthorized === true
      });
    this.metrics = options.metrics || new TransportMetrics();
    this.factory = options.factory
      || new TransportFactory({
        timeoutPolicy: this.timeoutPolicy,
        tlsPolicy: this.tlsPolicy
      });
    this._httpClient = options.httpClient || null;
    this._createHttpsAgent = options.createHttpsAgent || null;
    // Testes com httpClient injetado não devem esperar backoff real.
    this._skipBackoff = options.skipBackoff === true
      || typeof options.httpClient === 'function';

    this.timeoutMs = this.timeoutPolicy.defaultTimeoutMs;
    this.maxRetries = this.retryPolicy.maxAttempts;
    this.minTlsVersion = this.tlsPolicy.minVersion;
    this.rejectUnauthorized = this.tlsPolicy.rejectUnauthorized;
  }

  /**
   * Habilitado conforme TransportEnablement (Plataforma RC1).
   * Sem argumento → false (compatibilidade).
   *
   * @param {string} [operacao]
   * @returns {boolean}
   */
  isEnabled(operacao) {
    if (!operacao) return false;
    return isTransportEnabledFor(operacao);
  }

  getMetrics() {
    return this.metrics;
  }

  getFactory() {
    return this.factory;
  }

  getRetryPolicy() {
    return this.retryPolicy;
  }

  getTimeoutPolicy() {
    return this.timeoutPolicy;
  }

  getTlsPolicy() {
    return this.tlsPolicy;
  }

  getConfig() {
    return Object.freeze({
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      minTlsVersion: this.minTlsVersion,
      rejectUnauthorized: this.rejectUnauthorized,
      enabledOperations: [...ENABLED_OPERATIONS],
      enabled: ENABLED_OPERATIONS.some((op) => this.isEnabled(op)),
      retry: this.retryPolicy.toJSON(),
      timeout: this.timeoutPolicy.toJSON(),
      tls: this.tlsPolicy.toJSON()
    });
  }

  /**
   * @param {object|TransportRequest} request
   * @returns {Promise<TransportResponse>}
   */
  async send(request) {
    const started = process.hrtime.bigint();
    const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

    let normalized = null;
    try {
      normalized = this._normalizeRequest(request);
    } catch (error) {
      const response = TransportResponse.failure({
        status: 'invalid_request',
        tempo: elapsedMs(),
        error: error.message,
        attempts: 1
      });
      this.metrics.record(response);
      this._observeTelemetry(normalized, response);
      return response;
    }

    const operacao = normalized.operacao
      || normalized.context?.metadata?.operacao
      || null;

    if (!this.isEnabled(operacao)) {
      const response = TransportResponse.failure({
        status: 'not_implemented',
        tempo: elapsedMs(),
        error: `SoapTransport desabilitado para operação ${operacao || '(não informada)'}. Use soapClient.js.`,
        attempts: 1,
        warnings: [
          Object.freeze({
            code: 'TRANSPORT_DISABLED',
            message: 'isEnabled(operacao) === false — nenhuma chamada HTTP foi realizada.'
          })
        ]
      });
      this.metrics.record(response);
      this._observeTelemetry(normalized, response);
      return response;
    }

    const response = await this._sendEnabled(normalized, elapsedMs);
    this._observeTelemetry(normalized, response);
    return response;
  }

  /**
   * Telemetria RC6.6 — observe-only; nunca altera o TransportResponse.
   * @private
   */
  _observeTelemetry(request, response) {
    try {
      const meta = {
        ...(request?.context?.metadata || {}),
        ...(request?.metadata || {})
      };
      fiscalSoapTelemetry.observarTransport(request, response, {
        deferFinalize: meta.deferFinalize === true,
        correlationId: meta.correlationId,
        requestId: meta.requestId,
        origem: meta.origem || 'Registry',
        ambiente: meta.ambiente,
        uf: meta.uf,
        operacao: request?.operacao || meta.operacao,
        modelo: request?.modelo || meta.modelo
      });
    } catch (err) {
      console.warn('[FISCAL:TELEMETRIA] observe falhou (ignorado):', err.message);
    }
  }

  planRetry(failedAttempt) {
    return {
      shouldRetry: this.retryPolicy.shouldRetry(failedAttempt),
      delayMs: this.retryPolicy.getDelayMs(failedAttempt),
      maxTries: this.retryPolicy.getMaxTries()
    };
  }

  resolveTimeout(operacao, overrideMs) {
    return this.timeoutPolicy.resolve(operacao, overrideMs);
  }

  /**
   * @private
   */
  async _sendEnabled(request, elapsedMs) {
    const maxTries = this.retryPolicy.getMaxTries();
    let attempts = 0;
    let lastError = null;

    while (attempts < maxTries) {
      attempts += 1;
      try {
        const httpResult = await this._executeHttp(request);
        const response = TransportResponse.success({
          statusCode: httpResult.statusCode,
          status: 'ok',
          body: httpResult.body,
          headers: httpResult.headers || {},
          tempo: elapsedMs(),
          attempts
        });
        this.metrics.record(response, { retries: Math.max(0, attempts - 1) });
        return response;
      } catch (error) {
        lastError = error;
        const isTimeout = error.code === 'ECONNABORTED'
          || error.code === 'TIMEOUT'
          || /timeout/i.test(error.message || '');

        const canRetry = this.retryPolicy.shouldRetry(attempts)
          && (isTimeout || error.retryable);

        if (canRetry) {
          const delayMs = this.retryPolicy.getDelayMs(attempts);
          if (delayMs > 0 && !this._skipBackoff) {
            await sleep(delayMs);
          }
          continue;
        }
        break;
      }
    }

    const isTimeout = lastError
      && (lastError.code === 'ECONNABORTED'
        || lastError.code === 'TIMEOUT'
        || /timeout/i.test(lastError.message || ''));

    const response = TransportResponse.failure({
      status: isTimeout ? 'timeout' : 'error',
      statusCode: lastError?.statusCode || null,
      body: lastError?.body || null,
      tempo: elapsedMs(),
      error: lastError?.message || 'Falha no transporte SOAP.',
      attempts
    });
    this.metrics.record(response, {
      retries: Math.max(0, attempts - 1),
      timeout: Boolean(isTimeout)
    });
    return response;
  }

  /**
   * @private
   */
  async _executeHttp(request) {
    const ctx = request.context;
    const headers = {
      Accept: 'application/soap+xml, text/xml, */*',
      'User-Agent': PLATFORM_USER_AGENT,
      ...ctx.headers
    };
    if (ctx.soapAction && !headers['Content-Type']) {
      headers['Content-Type'] =
        `application/soap+xml; charset=utf-8; action="${ctx.soapAction}"`;
    }

    if (typeof this._httpClient === 'function') {
      return this._httpClient({
        url: ctx.endpoint,
        envelope: request.envelope,
        headers,
        timeout: ctx.timeout,
        certificado: ctx.certificado,
        senha: ctx.senha,
        soapAction: ctx.soapAction
      });
    }

    return this._defaultAxiosPost({
      url: ctx.endpoint,
      envelope: request.envelope,
      headers,
      timeout: ctx.timeout,
      certificado: ctx.certificado,
      senha: ctx.senha
    });
  }

  /**
   * @private
   */
  async _defaultAxiosPost({ url, envelope, headers, timeout, certificado, senha }) {
    let httpsAgent;
    if (typeof this._createHttpsAgent === 'function') {
      httpsAgent = this._createHttpsAgent({ url, certificado, senha, tls: this.tlsPolicy });
    } else {
      const { carregarCertificadoPfx } = require('../certificateService');
      if (!certificado) {
        const err = new Error('Certificado não configurado para SoapTransport.');
        err.code = 'CERT_MISSING';
        throw err;
      }
      const cert = carregarCertificadoPfx(certificado, senha);
      const host = new URL(url).hostname;
      httpsAgent = new https.Agent({
        key: cert.privateKeyPem,
        cert: cert.certBundlePem || cert.certPem,
        rejectUnauthorized: this.tlsPolicy.rejectUnauthorized,
        minVersion: this.tlsPolicy.minVersion,
        keepAlive: this.tlsPolicy.keepAlive,
        servername: host
      });
    }

    try {
      const response = await axios.post(url, envelope, {
        httpsAgent,
        proxy: false,
        timeout: timeout || this.timeoutMs,
        responseType: 'text',
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        transitional: { forcedJSONParsing: false },
        headers
      });
      return {
        statusCode: response.status,
        body: response.data,
        headers: response.headers || {}
      };
    } catch (error) {
      const statusCode = error.response?.status || null;
      const rawBody = error.response?.data || null;
      const wrapped = new Error(
        formatSoapHttpError({ url, statusCode, rawBody, fallback: error.message })
      );
      wrapped.code = error.code || 'NETWORK_ERROR';
      wrapped.statusCode = statusCode;
      wrapped.body = rawBody;
      throw wrapped;
    }
  }

  /**
   * @private
   */
  _normalizeRequest(request) {
    if (request instanceof TransportRequest) {
      return request;
    }
    if (!request || typeof request !== 'object') {
      throw TransportException.invalidRequest('SoapTransport.send: request inválido.');
    }

    if (request.url && request.envelope && !request.context && !request.definition) {
      return this.factory.createRequest({
        definition: {
          endpoint: request.url,
          soapAction: request.soapAction || '',
          namespace: request.namespace || '',
          versao: request.versao || '4.00',
          modelo: request.modelo || 'NFCE',
          operacao: request.operacao || null,
          ambiente: request.ambiente || 'HOMOLOGACAO',
          uf: request.uf || 'SVRS',
          timeout: request.timeout,
          headers: request.headers
        },
        envelope: request.envelope,
        certificado: request.certificadoPath || request.certificado || null,
        senha: request.certificadoSenha || request.senha || null
      });
    }

    return this.factory.createRequest(request);
  }
}

module.exports = {
  SoapTransport,
  formatSoapHttpError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  PLATFORM_USER_AGENT
};
