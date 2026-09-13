/**
 * Consulta por Chave (Consulta Protocolo) — runtime da Plataforma Fiscal (Sprint F8 / RC1.1).
 *
 * Fluxo:
 *   Consulta → FiscalWebServices → UrlResolver → Registry
 *            → TransportFactory → SoapTransport → SEFAZ
 *
 * Fallback automático → consultaProtocoloLegado.
 *
 * Não altera emissão, cancelamento, MIIP, Central, Compras, etc.
 *
 * @module services/fiscal/consultaProtocoloRuntime
 */

const { FiscalWebServices } = require('./core/FiscalWebServices');
const { ModelType } = require('./core/ModelType');
const { OperationType } = require('./core/OperationType');
const { EnvironmentType, fromAmbienteCode } = require('./core/EnvironmentType');
const { ResolutionSource } = require('./core/ResolutionSource');
const { UF_SVRS } = require('./core/RegistryBuilder');
const { logFiscalRuntime } = require('./core/FiscalRuntimeLog');
const { buildRuntimeResult } = require('./core/FiscalRuntimeResult');
const {
  montarEnvelopeConsultaProtocolo,
  enviarConsultaProtocoloLegado,
  getConsultaProtocoloUrl,
  NS_CONSULTA,
  ACTION_CONSULTA
} = require('./consultaProtocoloLegado');
const { ConsultaProtocoloMetrics } = require('./consultaProtocoloMetrics');

const defaultMetrics = new ConsultaProtocoloMetrics();
const OP = 'CONSULTA_PROTOCOLO';

/**
 * @param {object} [options]
 * @param {FiscalWebServices} [options.platform]
 * @param {ConsultaProtocoloMetrics} [options.metrics]
 * @param {Function} [options.legadoSender]
 * @returns {object}
 */
function createConsultaProtocoloRuntime(options = {}) {
  const platform = options.platform || new FiscalWebServices();
  const metrics = options.metrics || defaultMetrics;
  const legadoSender = options.legadoSender || enviarConsultaProtocoloLegado;

  /**
   * Consulta situação da NF-e/NFC-e pela chave de acesso.
   *
   * @param {object} input
   * @param {string} [input.chave]
   * @param {number|string} [input.ambiente]
   * @param {string} [input.modelo='NFCE'] NFCE|NFE
   * @param {string} [input.uf='SVRS']
   * @param {string} [input.cUF='23']
   * @param {string} [input.versao='4.00']
   * @param {string} [input.certificadoPath]
   * @param {string} [input.certificadoSenha]
   * @param {string} [input.envelope]
   * @returns {Promise<object>}
   */
  async function consultarProtocolo(input = {}) {
    const totalStarted = process.hrtime.bigint();
    const nowMs = () => Number(process.hrtime.bigint() - totalStarted) / 1e6;

    const ambiente = normalizeAmbiente(input.ambiente);
    const ambienteCode = ambiente === EnvironmentType.PRODUCAO ? 1 : 2;
    const modelo = normalizeModelo(input.modelo);
    const uf = String(input.uf || UF_SVRS).toUpperCase();
    const cUF = String(input.cUF || '23').replace(/\D/g, '').padStart(2, '0');
    const versao = input.versao || '4.00';
    const chave = String(input.chave || '').replace(/\D/g, '');
    const warnings = [];

    const xmlStarted = process.hrtime.bigint();
    const envelope = input.envelope || montarEnvelopeConsultaProtocolo({
      tpAmb: ambienteCode,
      chave: chave || '0'.repeat(44),
      cUF,
      versao
    });
    const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

    const resolverStarted = process.hrtime.bigint();
    const resolution = platform.resolve({
      modelo,
      operacao: OperationType.CONSULTA_PROTOCOLO,
      ambiente,
      uf,
      versao
    });
    const tempoResolverMs = Number(process.hrtime.bigint() - resolverStarted) / 1e6;

    const def = resolution.definition || null;
    logFiscalRuntime(OP, {
      Ambiente: ambiente,
      UF: uf,
      Modelo: modelo,
      Operacao: OperationType.CONSULTA_PROTOCOLO,
      Registry: resolution.success,
      Endpoint: def?.endpoint || null,
      Namespace: def?.namespace || NS_CONSULTA,
      Versao: def?.versao || versao,
      SOAPAction: def?.soapAction || ACTION_CONSULTA,
      'Tempo Resolver': tempoResolverMs,
      'Tempo XML': tempoXmlMs
    });

    let tempoPlataformaMs = tempoResolverMs + tempoXmlMs;
    let tempoTransporteMs = 0;
    let tempoSoapMs = 0;
    let tempoLegadoMs = 0;
    let retries = 0;

    if (resolution.success && def) {
      const transport = platform.getSoapTransport();
      const request = transport.getFactory().createRequest({
        definition: def,
        envelope,
        certificado: input.certificadoPath || null,
        senha: input.certificadoSenha || null,
        operacao: OperationType.CONSULTA_PROTOCOLO,
        modelo
      });

      const transportStarted = process.hrtime.bigint();
      const transportResponse = await transport.send(request);
      tempoTransporteMs = Number(process.hrtime.bigint() - transportStarted) / 1e6;
      tempoSoapMs = tempoTransporteMs;
      tempoPlataformaMs = nowMs();
      retries = Math.max(0, (transportResponse.attempts || 1) - 1);

      logFiscalRuntime(OP, {
        'Tempo Transporte/SOAP': tempoTransporteMs,
        'Transport success': transportResponse.success,
        Fallback: false,
        Retry: retries
      });

      if (transportResponse.success) {
        const result = buildRuntimeResult({
          success: true,
          source: 'PLATFORM',
          resolutionSource: resolution.source || ResolutionSource.REGISTRY,
          operacao: OperationType.CONSULTA_PROTOCOLO,
          endpoint: def.endpoint,
          namespace: def.namespace || NS_CONSULTA,
          soapAction: def.soapAction || ACTION_CONSULTA,
          versao: def.versao || versao,
          ambiente,
          uf,
          modelo,
          chave: chave || null,
          body: transportResponse.body,
          statusCode: transportResponse.statusCode,
          warnings: [...(resolution.warnings || []), ...(transportResponse.warnings || [])],
          tempoResolverMs,
          tempoTransporteMs,
          tempoXmlMs,
          tempoSoapMs,
          tempoPlataformaMs,
          tempoLegadoMs: 0,
          tempoTotalMs: nowMs(),
          fallbackUtilizado: false,
          retries,
          cStat: extrairCStat(transportResponse.body),
          xMotivo: extrairXMotivo(transportResponse.body)
        });
        logFiscalRuntime(OP, {
          Resultado: result.cStat || 'OK',
          'Tempo Total': result.tempoTotalMs,
          Fallback: false
        });
        metrics.record(result);
        return result;
      }

      warnings.push({
        code: 'PLATFORM_TRANSPORT_FAILED',
        message: transportResponse.error || 'Falha no SoapTransport da consulta protocolo.'
      });
    } else {
      warnings.push({
        code: 'PLATFORM_RESOLVE_FAILED',
        message: resolution.error || 'Falha ao resolver contrato de Consulta Protocolo.'
      });
    }

    const legadoUrl = def?.endpoint || getConsultaProtocoloUrl(ambienteCode, modelo);

    const legadoStarted = process.hrtime.bigint();
    const legado = await legadoSender({
      url: legadoUrl,
      envelope,
      ambiente: ambienteCode,
      modelo,
      chave,
      cUF,
      versao,
      certificadoPath: input.certificadoPath,
      certificadoSenha: input.certificadoSenha,
      timeoutMs: 30000,
      httpClient: input.legadoHttpClient || null
    });
    tempoLegadoMs = Number(process.hrtime.bigint() - legadoStarted) / 1e6;

    warnings.push({
      code: 'FALLBACK',
      message: 'Fluxo legado (consultaProtocoloLegado) executado após falha da plataforma.'
    });

    const result = buildRuntimeResult({
      success: Boolean(legado.success),
      source: ResolutionSource.FALLBACK,
      resolutionSource: resolution.source || null,
      operacao: OperationType.CONSULTA_PROTOCOLO,
      endpoint: legado.endpoint || legadoUrl,
      namespace: legado.namespace || NS_CONSULTA,
      soapAction: legado.soapAction || ACTION_CONSULTA,
      versao: legado.versao || versao,
      ambiente,
      uf,
      modelo,
      chave: chave || null,
      body: legado.body,
      statusCode: legado.statusCode,
      error: legado.success ? null : (legado.message || 'Falha no fluxo legado de consulta protocolo.'),
      warnings,
      tempoResolverMs,
      tempoTransporteMs,
      tempoXmlMs: tempoXmlMs + (Number(legado.tempoXmlMs) || 0),
      tempoSoapMs: Number(legado.tempoSoapMs) || 0,
      tempoPlataformaMs,
      tempoLegadoMs,
      tempoTotalMs: nowMs(),
      fallbackUtilizado: true,
      retries,
      cStat: extrairCStat(legado.body),
      xMotivo: extrairXMotivo(legado.body)
    });

    logFiscalRuntime(OP, {
      'Tempo Legado': tempoLegadoMs,
      'Tempo Total': result.tempoTotalMs,
      Fallback: true,
      Endpoint: result.endpoint,
      Resultado: result.cStat || (result.success ? 'OK' : 'ERRO'),
      Retry: retries
    });

    metrics.record(result);
    return result;
  }

  return {
    consultarProtocolo,
    getMetrics: () => metrics,
    getPlatform: () => platform
  };
}

function normalizeAmbiente(ambiente) {
  if (ambiente === EnvironmentType.PRODUCAO || ambiente === EnvironmentType.HOMOLOGACAO) {
    return ambiente;
  }
  const fromCode = fromAmbienteCode(ambiente);
  return fromCode || EnvironmentType.HOMOLOGACAO;
}

function normalizeModelo(modelo) {
  if (modelo === ModelType.NFE || String(modelo).toUpperCase() === 'NFE' || String(modelo) === '55') {
    return ModelType.NFE;
  }
  return ModelType.NFCE;
}

/**
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairCStat(body) {
  if (!body || typeof body !== 'string') return null;
  const match = body.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
  return match ? match[1] : null;
}

/**
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairXMotivo(body) {
  if (!body || typeof body !== 'string') return null;
  const match = body.match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  return match ? match[1].trim() : null;
}

const runtimePadrao = createConsultaProtocoloRuntime();

module.exports = {
  createConsultaProtocoloRuntime,
  consultarProtocolo: runtimePadrao.consultarProtocolo,
  getConsultaProtocoloMetrics: () => runtimePadrao.getMetrics(),
  ConsultaProtocoloMetrics,
  montarEnvelopeConsultaProtocolo,
  extrairCStat,
  extrairXMotivo
};
