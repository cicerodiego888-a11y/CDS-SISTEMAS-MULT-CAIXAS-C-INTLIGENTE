/**
 * Consulta NFeStatusServico — consumidor da Plataforma Fiscal (Sprint F5 / RC1.1).
 *
 * Fluxo:
 *   Status → FiscalWebServices → UrlResolver → Registry
 *         → TransportFactory → SoapTransport → SEFAZ
 *
 * Fallback automático para statusServicoLegado (soap/axios direto).
 *
 * @module services/fiscal/statusServico
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
  montarEnvelopeStatusServico,
  enviarStatusServicoLegado,
  NS_STATUS,
  ACTION_STATUS
} = require('./statusServicoLegado');
const { StatusServicoMetrics } = require('./statusServicoMetrics');

const defaultMetrics = new StatusServicoMetrics();
const OP = 'STATUS_SERVICO';

/**
 * @param {object} [options]
 * @param {FiscalWebServices} [options.platform]
 * @param {StatusServicoMetrics} [options.metrics]
 * @param {Function} [options.legadoSender] Override do envio legado (testes)
 * @returns {object}
 */
function createStatusServicoRuntime(options = {}) {
  const platform = options.platform || new FiscalWebServices();
  const metrics = options.metrics || defaultMetrics;
  const legadoSender = options.legadoSender || enviarStatusServicoLegado;

  /**
   * Consulta status do serviço SEFAZ (NFC-e / SVRS).
   *
   * @param {object} input
   * @param {number|string} [input.ambiente] 1|2 ou EnvironmentType
   * @param {string} [input.uf='SVRS']
   * @param {string} [input.cUF='23']
   * @param {string} [input.certificadoPath]
   * @param {string} [input.certificadoSenha]
   * @param {string} [input.versao='4.00']
   * @returns {Promise<object>}
   */
  async function consultarStatusServico(input = {}) {
    const totalStarted = process.hrtime.bigint();
    const nowMs = () => Number(process.hrtime.bigint() - totalStarted) / 1e6;

    const ambiente = normalizeAmbiente(input.ambiente);
    const uf = String(input.uf || UF_SVRS).toUpperCase();
    const cUF = String(input.cUF || '23').replace(/\D/g, '').padStart(2, '0');
    const versao = input.versao || '4.00';
    const certificadoPath = input.certificadoPath || null;
    const certificadoSenha = input.certificadoSenha || null;
    const warnings = [];

    const xmlStarted = process.hrtime.bigint();
    const envelope = montarEnvelopeStatusServico({
      tpAmb: ambiente === EnvironmentType.PRODUCAO ? 1 : 2,
      cUF,
      versao
    });
    const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

    // --- Plataforma Fiscal ---
    const resolverStarted = process.hrtime.bigint();
    const resolution = platform.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.STATUS_SERVICO,
      ambiente,
      uf,
      versao
    });
    const tempoResolverMs = Number(process.hrtime.bigint() - resolverStarted) / 1e6;

    const def = resolution.definition || null;
    logFiscalRuntime(OP, {
      Ambiente: ambiente,
      UF: uf,
      Modelo: ModelType.NFCE,
      Operacao: OperationType.STATUS_SERVICO,
      Registry: resolution.success,
      Endpoint: def?.endpoint || null,
      Namespace: def?.namespace || NS_STATUS,
      Versao: def?.versao || versao,
      SOAPAction: def?.soapAction || ACTION_STATUS,
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
        certificado: certificadoPath,
        senha: certificadoSenha,
        operacao: OperationType.STATUS_SERVICO,
        modelo: ModelType.NFCE
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
          operacao: OperationType.STATUS_SERVICO,
          modelo: ModelType.NFCE,
          ambiente,
          uf,
          endpoint: def.endpoint,
          namespace: def.namespace || NS_STATUS,
          soapAction: def.soapAction || ACTION_STATUS,
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
          cStat: extrairCStat(transportResponse.body)
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
        message: transportResponse.error || 'Falha no SoapTransport da plataforma.'
      });
    } else {
      warnings.push({
        code: 'PLATFORM_RESOLVE_FAILED',
        message: resolution.error || 'Falha ao resolver contrato de Status Serviço.'
      });
    }

    // --- Fallback legado ---
    const legadoUrl = def?.endpoint || obterUrlLegadoPadrao(ambiente);

    const legadoStarted = process.hrtime.bigint();
    const legado = await legadoSender({
      url: legadoUrl,
      envelope,
      certificadoPath,
      certificadoSenha,
      timeoutMs: 30000,
      httpClient: input.legadoHttpClient || null
    });
    tempoLegadoMs = Number(process.hrtime.bigint() - legadoStarted) / 1e6;

    warnings.push({
      code: 'FALLBACK',
      message: 'Fluxo legado (statusServicoLegado) executado após falha da plataforma.'
    });

    const result = buildRuntimeResult({
      success: Boolean(legado.success),
      source: ResolutionSource.FALLBACK,
      resolutionSource: resolution.source || null,
      operacao: OperationType.STATUS_SERVICO,
      modelo: ModelType.NFCE,
      ambiente,
      uf,
      endpoint: legadoUrl,
      namespace: def?.namespace || NS_STATUS,
      soapAction: def?.soapAction || ACTION_STATUS,
      versao: def?.versao || versao,
      body: legado.body,
      statusCode: legado.statusCode,
      error: legado.success ? null : (legado.message || 'Falha no fluxo legado.'),
      warnings,
      tempoResolverMs,
      tempoTransporteMs,
      tempoXmlMs,
      tempoSoapMs,
      tempoPlataformaMs,
      tempoLegadoMs,
      tempoTotalMs: nowMs(),
      fallbackUtilizado: true,
      retries,
      cStat: extrairCStat(legado.body)
    });

    logFiscalRuntime(OP, {
      'Tempo Legado': tempoLegadoMs,
      'Tempo Total': result.tempoTotalMs,
      Fallback: true,
      Endpoint: legadoUrl,
      Resultado: result.cStat || (result.success ? 'OK' : 'ERRO'),
      Retry: retries
    });

    metrics.record(result);
    return result;
  }

  return {
    consultarStatusServico,
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

function obterUrlLegadoPadrao(ambiente) {
  return ambiente === EnvironmentType.PRODUCAO
    ? 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx'
    : 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx';
}

/**
 * Extrai cStat do retorno (quando presente).
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairCStat(body) {
  if (!body || typeof body !== 'string') return null;
  const match = body.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
  return match ? match[1] : null;
}

const runtimePadrao = createStatusServicoRuntime();

module.exports = {
  createStatusServicoRuntime,
  consultarStatusServico: runtimePadrao.consultarStatusServico,
  getStatusServicoMetrics: () => runtimePadrao.getMetrics(),
  montarEnvelopeStatusServico,
  extrairCStat,
  StatusServicoMetrics
};
