/**
 * Distribuição DF-e — consumidor da Plataforma Fiscal (Sprint F6 / RC1.1).
 *
 * Fluxo:
 *   DF-e → FiscalWebServices → UrlResolver → Registry
 *       → TransportFactory → SoapTransport → SEFAZ
 *
 * Fallback automático → distribuicaoDfeLegado.
 *
 * @module services/fiscal/distribuicaoDfeRuntime
 */

const { FiscalWebServices } = require('./core/FiscalWebServices');
const { ModelType } = require('./core/ModelType');
const { OperationType } = require('./core/OperationType');
const { EnvironmentType, fromAmbienteCode } = require('./core/EnvironmentType');
const { ResolutionSource } = require('./core/ResolutionSource');
const { UF_AN } = require('./core/RegistryBuilder');
const { logFiscalRuntime } = require('./core/FiscalRuntimeLog');
const { buildRuntimeResult } = require('./core/FiscalRuntimeResult');
const {
  enviarDistribuicaoDfeLegado,
  getDfeUrl,
  montarSoapDFe,
  NS_DFE,
  ACTION_DFE
} = require('./distribuicaoDfeLegado');
const { DistribuicaoDfeMetrics } = require('./distribuicaoDfeMetrics');
const { fiscalSoapTelemetry } = require('./core/FiscalSoapTelemetry');

const defaultMetrics = new DistribuicaoDfeMetrics();
const OP = 'DISTRIBUICAO_DFE';

/**
 * @param {object} [options]
 * @param {FiscalWebServices} [options.platform]
 * @param {DistribuicaoDfeMetrics} [options.metrics]
 * @param {Function} [options.legadoSender]
 * @returns {object}
 */
function createDistribuicaoDfeRuntime(options = {}) {
  const platform = options.platform || new FiscalWebServices();
  const metrics = options.metrics || defaultMetrics;
  const legadoSender = options.legadoSender || enviarDistribuicaoDfeLegado;

  /**
   * Envia consulta DF-e (distNSU / consChNFe) via plataforma + fallback.
   *
   * @param {object} input
   * @param {string} input.xmlConsulta
   * @param {number|string} [input.ambiente]
   * @param {string} [input.cUF='23']
   * @param {string} [input.certificadoPath]
   * @param {string} [input.certificadoSenha]
   * @param {string} [input.versao='1.01']
   * @param {Function} [input.legadoHttpClient]
   * @returns {Promise<object>}
   */
  async function enviarDistribuicaoDfe(input = {}) {
    const totalStarted = process.hrtime.bigint();
    const nowMs = () => Number(process.hrtime.bigint() - totalStarted) / 1e6;

    const ambiente = normalizeAmbiente(input.ambiente);
    const ambienteCode = ambiente === EnvironmentType.PRODUCAO ? 1 : 2;
    const cUF = String(input.cUF || '23').replace(/\D/g, '').padStart(2, '0');
    const versao = input.versao || '1.01';
    const certificadoPath = input.certificadoPath || null;
    const certificadoSenha = input.certificadoSenha || null;
    const xmlConsulta = input.xmlConsulta;
    const warnings = [];

    const { correlationId, requestId } = fiscalSoapTelemetry.iniciar({
      correlationId: input.correlationId || null,
      operacao: OperationType.DISTRIBUICAO_DFE,
      modelo: ModelType.NFE,
      ambiente,
      uf: UF_AN,
      origem: 'Registry'
    });

    if (!xmlConsulta) {
      const fail = buildRuntimeResult({
        success: false,
        source: null,
        operacao: OperationType.DISTRIBUICAO_DFE,
        modelo: ModelType.NFE,
        ambiente,
        uf: UF_AN,
        error: 'xmlConsulta é obrigatório.',
        body: null,
        fallbackUtilizado: false,
        tempoResolverMs: 0,
        tempoTransporteMs: 0,
        tempoXmlMs: 0,
        tempoSoapMs: 0,
        tempoPlataformaMs: 0,
        tempoLegadoMs: 0,
        tempoTotalMs: nowMs(),
        retries: 0,
        telemetryRequestId: requestId,
        correlationId
      });
      fiscalSoapTelemetry.finalizar(requestId, {
        sucesso: false,
        resultado: 'ERRO',
        tempoTotalMs: fail.tempoTotalMs
      });
      metrics.record(fail);
      return fail;
    }

    const xmlStarted = process.hrtime.bigint();
    const envelope = montarSoapDFe(xmlConsulta, cUF, versao);
    const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

    const resolverStarted = process.hrtime.bigint();
    const resolution = platform.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.DISTRIBUICAO_DFE,
      ambiente,
      uf: UF_AN,
      versao
    });
    const tempoResolverMs = Number(process.hrtime.bigint() - resolverStarted) / 1e6;

    const def = resolution.definition || null;
    fiscalSoapTelemetry.atualizar(requestId, {
      endpoint: def?.endpoint || null,
      soapAction: def?.soapAction || ACTION_DFE,
      tempoResolverMs,
      tempoXmlMs,
      origem: resolution.source || 'Registry'
    });

    logFiscalRuntime(OP, {
      Ambiente: ambiente,
      UF: UF_AN,
      Modelo: ModelType.NFE,
      Operacao: OperationType.DISTRIBUICAO_DFE,
      Registry: resolution.success,
      Endpoint: def?.endpoint || null,
      Namespace: def?.namespace || NS_DFE,
      Versao: def?.versao || versao,
      SOAPAction: def?.soapAction || ACTION_DFE,
      'Tempo Resolver': tempoResolverMs,
      'Tempo XML': tempoXmlMs,
      CorrelationId: correlationId,
      RequestId: requestId
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
        certificado: certificadoPath,
        senha: certificadoSenha,
        operacao: OperationType.DISTRIBUICAO_DFE,
        modelo: ModelType.NFE,
        metadata: {
          correlationId,
          requestId,
          deferFinalize: true,
          origem: resolution.source || 'Registry',
          ambiente,
          uf: UF_AN
        }
      });

      const transportStarted = process.hrtime.bigint();
      const transportResponse = await transport.send(request);
      tempoTransporteMs = Number(process.hrtime.bigint() - transportStarted) / 1e6;
      tempoSoapMs = tempoTransporteMs;
      tempoPlataformaMs = nowMs();
      retries = Math.max(0, (transportResponse.attempts || 1) - 1);

      fiscalSoapTelemetry.atualizar(requestId, {
        tempoTransporteMs,
        tempoResolverMs,
        tempoXmlMs,
        retry: retries,
        httpStatus: transportResponse.statusCode,
        transportSuccess: transportResponse.success,
        endpoint: def.endpoint,
        soapAction: def.soapAction || ACTION_DFE
      });

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
          operacao: OperationType.DISTRIBUICAO_DFE,
          modelo: ModelType.NFE,
          ambiente,
          uf: UF_AN,
          endpoint: def.endpoint,
          namespace: def.namespace || NS_DFE,
          soapAction: def.soapAction || ACTION_DFE,
          versao: def.versao || versao,
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
          telemetryRequestId: requestId,
          correlationId
        });
        logFiscalRuntime(OP, {
          Resultado: 'OK',
          'Tempo Total': result.tempoTotalMs,
          Fallback: false
        });
        metrics.record(result);
        // Finalização com cStat/persistência fica a cargo de distribuicaoDFe (defer).
        return result;
      }

      warnings.push({
        code: 'PLATFORM_TRANSPORT_FAILED',
        message: transportResponse.error || 'Falha no SoapTransport DF-e.'
      });
    } else {
      warnings.push({
        code: 'PLATFORM_RESOLVE_FAILED',
        message: resolution.error || 'Falha ao resolver contrato DF-e.'
      });
    }

    const legadoUrl = def?.endpoint || getDfeUrl(ambienteCode);
    const legadoStarted = process.hrtime.bigint();
    const legado = await legadoSender({
      xmlConsulta,
      certificadoPath,
      certificadoSenha,
      ambiente: ambienteCode,
      cUF,
      url: legadoUrl,
      httpClient: input.legadoHttpClient || null
    });
    tempoLegadoMs = Number(process.hrtime.bigint() - legadoStarted) / 1e6;

    warnings.push({
      code: 'FALLBACK',
      message: 'Fluxo legado (distribuicaoDfeLegado) executado após falha da plataforma.'
    });

    const tempoTotalMs = nowMs();
    const result = buildRuntimeResult({
      success: Boolean(legado.success),
      source: ResolutionSource.FALLBACK,
      resolutionSource: resolution.source || null,
      operacao: OperationType.DISTRIBUICAO_DFE,
      modelo: ModelType.NFE,
      ambiente,
      uf: UF_AN,
      endpoint: legado.endpoint || legadoUrl,
      namespace: legado.namespace || NS_DFE,
      soapAction: legado.soapAction || ACTION_DFE,
      versao: legado.versao || versao,
      body: legado.body,
      statusCode: legado.statusCode,
      error: legado.success ? null : (legado.message || 'Falha no fluxo legado DF-e.'),
      warnings,
      tempoResolverMs,
      tempoTransporteMs,
      tempoXmlMs: tempoXmlMs + (Number(legado.tempoXmlMs) || 0),
      tempoSoapMs: Number(legado.tempoSoapMs) || 0,
      tempoPlataformaMs,
      tempoLegadoMs,
      tempoTotalMs,
      fallbackUtilizado: true,
      retries,
      telemetryRequestId: requestId,
      correlationId
    });

    fiscalSoapTelemetry.atualizar(requestId, {
      endpoint: result.endpoint,
      soapAction: result.soapAction,
      httpStatus: result.statusCode,
      tempoResolverMs,
      tempoXmlMs: result.tempoXmlMs,
      tempoTransporteMs: result.tempoSoapMs || tempoTransporteMs,
      tempoTotalMs,
      fallbackUtilizado: true,
      transportSuccess: Boolean(legado.success),
      retry: retries,
      erro: result.error
    });

    logFiscalRuntime(OP, {
      'Tempo Legado': tempoLegadoMs,
      'Tempo Total': result.tempoTotalMs,
      Fallback: true,
      Endpoint: result.endpoint,
      Resultado: result.success ? 'OK' : 'ERRO',
      Retry: retries
    });

    if (!result.success) {
      fiscalSoapTelemetry.finalizar(requestId, {
        sucesso: false,
        resultado: 'ERRO',
        tempoTotalMs,
        fallbackUtilizado: true
      });
    }

    metrics.record(result);
    return result;
  }

  return {
    enviarDistribuicaoDfe,
    getMetrics: () => metrics,
    getPlatform: () => platform
  };
}

function normalizeAmbiente(ambiente) {
  if (ambiente === EnvironmentType.PRODUCAO || ambiente === EnvironmentType.HOMOLOGACAO) {
    return ambiente;
  }
  if (ambiente === 1 || ambiente === '1') return EnvironmentType.PRODUCAO;
  if (ambiente === 2 || ambiente === '2') return EnvironmentType.HOMOLOGACAO;
  const fromCode = fromAmbienteCode(ambiente);
  return fromCode || EnvironmentType.HOMOLOGACAO;
}

const runtimePadrao = createDistribuicaoDfeRuntime();

module.exports = {
  createDistribuicaoDfeRuntime,
  enviarDistribuicaoDfe: runtimePadrao.enviarDistribuicaoDfe,
  getDistribuicaoDfeMetrics: () => runtimePadrao.getMetrics(),
  DistribuicaoDfeMetrics,
  getDfeUrl
};
