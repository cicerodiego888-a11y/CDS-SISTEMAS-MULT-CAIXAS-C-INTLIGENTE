/**
 * Autorização NFC-e — runtime da Plataforma Fiscal (Sprint F10 / RC1.1).
 *
 * Fluxo:
 *   Autorização → FiscalWebServices → UrlResolver → Registry
 *               → TransportFactory → SoapTransport → SEFAZ
 *
 * Fallback automático → autorizacaoLegado → soapClient → SEFAZ
 *
 * Não altera XML, assinatura, QRCode, DANFE, lote, persistência nem regras fiscais.
 * Responsabilidade exclusiva: transporte SOAP do lote.
 *
 * @module services/fiscal/autorizacaoRuntime
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
  montarEnvelopeAutorizacao,
  enviarAutorizacaoLegado,
  getAutorizacaoUrl,
  NS_AUTORIZACAO,
  ACTION_AUTORIZACAO
} = require('./autorizacaoLegado');
const { AutorizacaoMetrics } = require('./autorizacaoMetrics');

const defaultMetrics = new AutorizacaoMetrics();
const OP = 'AUTORIZACAO';

/**
 * @param {object} [options]
 * @returns {object}
 */
function createAutorizacaoRuntime(options = {}) {
  const platform = options.platform || new FiscalWebServices();
  const metrics = options.metrics || defaultMetrics;
  const legadoSender = options.legadoSender || enviarAutorizacaoLegado;

  /**
   * Envia lote de autorização NFC-e via plataforma + fallback.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function enviarAutorizacao(input = {}) {
    const totalStarted = process.hrtime.bigint();
    const nowMs = () => Number(process.hrtime.bigint() - totalStarted) / 1e6;

    const ambiente = normalizeAmbiente(input.ambiente);
    const ambienteCode = ambiente === EnvironmentType.PRODUCAO ? 1 : 2;
    const uf = String(input.uf || UF_SVRS).toUpperCase();
    const cUF = String(input.cUF || '23').replace(/\D/g, '').padStart(2, '0');
    const versao = input.versaoDados || input.versao || '4.00';
    const loteXml = input.loteXml || '';
    const warnings = [];

    const xmlStarted = process.hrtime.bigint();
    const envelope = input.envelope || montarEnvelopeAutorizacao({
      loteXml: loteXml || '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc></enviNFe>',
      cUF,
      versaoDados: versao
    });
    const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

    const resolverStarted = process.hrtime.bigint();
    const resolution = platform.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
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
      Operacao: OperationType.AUTORIZACAO,
      Registry: resolution.success,
      Endpoint: def?.endpoint || null,
      Namespace: def?.namespace || NS_AUTORIZACAO,
      Versao: def?.versao || versao,
      SOAPAction: def?.soapAction || ACTION_AUTORIZACAO,
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
        operacao: OperationType.AUTORIZACAO,
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
        const cStat = extrairCStatAutorizacao(transportResponse.body);
        const result = buildRuntimeResult({
          success: true,
          source: 'PLATFORM',
          resolutionSource: resolution.source || ResolutionSource.REGISTRY,
          operacao: OperationType.AUTORIZACAO,
          modelo: ModelType.NFCE,
          endpoint: def.endpoint,
          namespace: def.namespace || NS_AUTORIZACAO,
          soapAction: def.soapAction || ACTION_AUTORIZACAO,
          versao: def.versao || versao,
          ambiente,
          uf,
          body: transportResponse.body,
          raw: transportResponse.body,
          status: 'soap_enviado',
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
          cStat,
          xMotivo: extrairXMotivo(transportResponse.body),
          resultado: classificarResultado(cStat, transportResponse.body)
        });
        logFiscalRuntime(OP, {
          Resultado: result.resultado,
          'Tempo Total': result.tempoTotalMs,
          Fallback: false
        });
        metrics.record(result);
        return result;
      }

      warnings.push({
        code: 'PLATFORM_TRANSPORT_FAILED',
        message: transportResponse.error || 'Falha no SoapTransport da autorização.'
      });
    } else {
      warnings.push({
        code: 'PLATFORM_RESOLVE_FAILED',
        message: resolution.error || 'Falha ao resolver contrato de Autorização.'
      });
    }

    const legadoUrl = input.url
      || def?.endpoint
      || getAutorizacaoUrl(ambienteCode);
    const legadoStarted = process.hrtime.bigint();
    const legado = await legadoSender({
      url: legadoUrl,
      loteXml,
      envelope,
      ambiente: ambienteCode,
      cUF,
      versaoDados: versao,
      certificadoPath: input.certificadoPath,
      certificadoSenha: input.certificadoSenha,
      timeoutMs: input.timeoutMs || 90000,
      httpClient: input.legadoHttpClient || null
    });
    tempoLegadoMs = Number(process.hrtime.bigint() - legadoStarted) / 1e6;

    warnings.push({
      code: 'FALLBACK',
      message: 'Fluxo legado (autorizacaoLegado/soapClient) executado após falha da plataforma.'
    });

    const body = legado.body || legado.raw || null;
    const cStat = extrairCStatAutorizacao(body);
    const result = buildRuntimeResult({
      success: Boolean(legado.success),
      source: ResolutionSource.FALLBACK,
      resolutionSource: resolution.source || null,
      operacao: OperationType.AUTORIZACAO,
      modelo: ModelType.NFCE,
      endpoint: legado.endpoint || legadoUrl,
      namespace: legado.namespace || NS_AUTORIZACAO,
      soapAction: legado.soapAction || ACTION_AUTORIZACAO,
      versao: legado.versao || versao,
      ambiente,
      uf,
      body,
      raw: body,
      status: legado.status || (legado.success ? 'soap_enviado' : 'erro_transmissao'),
      statusCode: legado.statusCode,
      error: legado.success ? null : (legado.message || 'Falha no fluxo legado de autorização.'),
      message: legado.message || null,
      code: legado.code || null,
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
      cStat,
      xMotivo: extrairXMotivo(body),
      resultado: classificarResultado(cStat, body)
    });

    logFiscalRuntime(OP, {
      'Tempo Legado': tempoLegadoMs,
      'Tempo Total': result.tempoTotalMs,
      Fallback: true,
      Endpoint: result.endpoint,
      Resultado: result.resultado,
      Retry: retries
    });

    metrics.record(result);
    return result;
  }

  return {
    enviarAutorizacao,
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

/**
 * Prefere cStat de infProt; senão o primeiro cStat do body.
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairCStatAutorizacao(body) {
  if (!body || typeof body !== 'string') return null;
  const prot = body.match(/<infProt[\s\S]*?<cStat>\s*(\d+)\s*<\/cStat>/i);
  if (prot) return prot[1];
  const match = body.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
  return match ? match[1] : null;
}

/**
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairXMotivo(body) {
  if (!body || typeof body !== 'string') return null;
  const prot = body.match(/<infProt[\s\S]*?<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  if (prot) return prot[1].trim();
  const match = body.match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  return match ? match[1].trim() : null;
}

/**
 * @param {string|null} cStat
 * @param {string|null} [body]
 * @returns {string}
 */
function classificarResultado(cStat, body) {
  if (cStat === '100' || cStat === '150') return 'AUTORIZADO';
  if (cStat === '104') {
    const prot = body && typeof body === 'string'
      ? (body.match(/<infProt[\s\S]*?<cStat>\s*(\d+)\s*<\/cStat>/i) || [])[1]
      : null;
    if (prot === '100' || prot === '150') return 'AUTORIZADO';
    if (prot === '539') return 'DUPLICADO';
    if (prot) return 'REJEITADO';
    return 'LOTE_PROCESSADO';
  }
  if (cStat === '539') return 'DUPLICADO';
  if (cStat === '215' || cStat === '214' || cStat === '225') return 'LOTE_REJEITADO';
  if (cStat) return 'REJEITADO';
  return 'DESCONHECIDO';
}

const runtimePadrao = createAutorizacaoRuntime();

module.exports = {
  createAutorizacaoRuntime,
  enviarAutorizacao: runtimePadrao.enviarAutorizacao,
  getAutorizacaoMetrics: () => runtimePadrao.getMetrics(),
  AutorizacaoMetrics,
  montarEnvelopeAutorizacao,
  extrairCStatAutorizacao,
  extrairXMotivo,
  classificarResultado
};
