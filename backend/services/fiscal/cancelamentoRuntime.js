/**
 * Cancelamento NFC-e — runtime da Plataforma Fiscal (Sprint F9 / RC1.1).
 *
 * Fluxo:
 *   Cancelamento → FiscalWebServices → UrlResolver → Registry
 *                → TransportFactory → SoapTransport → SEFAZ
 *
 * Fallback automático → cancelamentoLegado.
 *
 * Não migra Autorização, Inutilização, CC-e nem outros eventos.
 *
 * @module services/fiscal/cancelamentoRuntime
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
  montarEnvelopeCancelamento,
  enviarCancelamentoLegado,
  getCancelamentoUrl,
  NS_EVENTO,
  ACTION_EVENTO,
  TP_EVENTO_CANCELAMENTO
} = require('./cancelamentoLegado');
const { CancelamentoMetrics } = require('./cancelamentoMetrics');

const defaultMetrics = new CancelamentoMetrics();
const OP = 'CANCELAMENTO';

/**
 * @param {object} [options]
 * @returns {object}
 */
function createCancelamentoRuntime(options = {}) {
  const platform = options.platform || new FiscalWebServices();
  const metrics = options.metrics || defaultMetrics;
  const legadoSender = options.legadoSender || enviarCancelamentoLegado;

  /**
   * Envia evento de cancelamento (110111) via plataforma + fallback.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function enviarCancelamento(input = {}) {
    const totalStarted = process.hrtime.bigint();
    const nowMs = () => Number(process.hrtime.bigint() - totalStarted) / 1e6;

    const ambiente = normalizeAmbiente(input.ambiente);
    const ambienteCode = ambiente === EnvironmentType.PRODUCAO ? 1 : 2;
    const uf = String(input.uf || UF_SVRS).toUpperCase();
    const cUF = String(input.cUF || '23').replace(/\D/g, '').padStart(2, '0');
    const versao = input.versao || '1.00';
    const warnings = [];

    const xmlStarted = process.hrtime.bigint();
    const envelope = input.envelope || montarEnvelopeCancelamento({
      tpAmb: ambienteCode,
      cUF,
      cnpj: input.cnpj || '00000000000000',
      chave: input.chave || '0'.repeat(44),
      protocolo: input.protocolo || '000000000000000',
      xJust: input.xJust || 'Cancelamento via plataforma fiscal',
      nSeqEvento: input.nSeqEvento || 1,
      idLote: input.idLote || '1'
    });
    const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

    const modelo = input.modelo === ModelType.NFE ? ModelType.NFE : ModelType.NFCE;

    const resolverStarted = process.hrtime.bigint();
    const resolution = platform.resolve({
      modelo,
      operacao: OperationType.CANCELAMENTO,
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
      Operacao: OperationType.CANCELAMENTO,
      tpEvento: TP_EVENTO_CANCELAMENTO,
      Registry: resolution.success,
      Endpoint: def?.endpoint || null,
      Namespace: def?.namespace || NS_EVENTO,
      Versao: def?.versao || versao,
      SOAPAction: def?.soapAction || ACTION_EVENTO,
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
        operacao: OperationType.CANCELAMENTO,
        modelo,
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
        const cStat = extrairCStatEvento(transportResponse.body);
        const result = buildRuntimeResult({
          success: true,
          source: 'PLATFORM',
          resolutionSource: resolution.source || ResolutionSource.REGISTRY,
          operacao: OperationType.CANCELAMENTO,
          modelo,
          endpoint: def.endpoint,
          namespace: def.namespace || NS_EVENTO,
          soapAction: def.soapAction || ACTION_EVENTO,
          versao: def.versao || versao,
          ambiente,
          uf,
          tpEvento: TP_EVENTO_CANCELAMENTO,
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
          cStat,
          xMotivo: extrairXMotivo(transportResponse.body),
          resultado: classificarResultado(cStat)
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
        message: transportResponse.error || 'Falha no SoapTransport do cancelamento.'
      });
    } else {
      warnings.push({
        code: 'PLATFORM_RESOLVE_FAILED',
        message: resolution.error || 'Falha ao resolver contrato de Cancelamento.'
      });
    }

    const legadoUrl = input.url || def?.endpoint || getCancelamentoUrl(ambienteCode);
    const legadoStarted = process.hrtime.bigint();
    const legado = await legadoSender({
      url: legadoUrl,
      envelope,
      ambiente: ambienteCode,
      cUF,
      cnpj: input.cnpj,
      chave: input.chave,
      protocolo: input.protocolo,
      xJust: input.xJust,
      certificadoPath: input.certificadoPath,
      certificadoSenha: input.certificadoSenha,
      httpsAgent: input.httpsAgent || null,
      timeoutMs: 30000,
      httpClient: input.legadoHttpClient || null
    });
    tempoLegadoMs = Number(process.hrtime.bigint() - legadoStarted) / 1e6;

    warnings.push({
      code: 'FALLBACK',
      message: 'Fluxo legado (cancelamentoLegado) executado após falha da plataforma.'
    });

    const cStat = extrairCStatEvento(legado.body);
    const result = buildRuntimeResult({
      success: Boolean(legado.success),
      source: ResolutionSource.FALLBACK,
      resolutionSource: resolution.source || null,
      operacao: OperationType.CANCELAMENTO,
      modelo,
      endpoint: legado.endpoint || legadoUrl,
      namespace: legado.namespace || NS_EVENTO,
      soapAction: legado.soapAction || ACTION_EVENTO,
      versao: legado.versao || versao,
      ambiente,
      uf,
      tpEvento: TP_EVENTO_CANCELAMENTO,
      body: legado.body,
      statusCode: legado.statusCode,
      error: legado.success ? null : (legado.message || 'Falha no fluxo legado de cancelamento.'),
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
      xMotivo: extrairXMotivo(legado.body),
      resultado: classificarResultado(cStat)
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
    enviarCancelamento,
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
 * Prefere cStat do retEvento/infEvento; senão o primeiro cStat do body.
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairCStatEvento(body) {
  if (!body || typeof body !== 'string') return null;
  const evento = body.match(/<infEvento[\s\S]*?<cStat>\s*(\d+)\s*<\/cStat>/i);
  if (evento) return evento[1];
  const match = body.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
  return match ? match[1] : null;
}

/**
 * @param {string|null} body
 * @returns {string|null}
 */
function extrairXMotivo(body) {
  if (!body || typeof body !== 'string') return null;
  const evento = body.match(/<infEvento[\s\S]*?<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  if (evento) return evento[1].trim();
  const match = body.match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  return match ? match[1].trim() : null;
}

/**
 * @param {string|null} cStat
 * @returns {string}
 */
function classificarResultado(cStat) {
  if (cStat === '135' || cStat === '155') return 'AUTORIZADO';
  if (cStat === '573' || cStat === '631') return 'DUPLICADO';
  if (cStat) return 'REJEITADO';
  return 'DESCONHECIDO';
}

const runtimePadrao = createCancelamentoRuntime();

module.exports = {
  createCancelamentoRuntime,
  enviarCancelamento: runtimePadrao.enviarCancelamento,
  getCancelamentoMetrics: () => runtimePadrao.getMetrics(),
  CancelamentoMetrics,
  montarEnvelopeCancelamento,
  extrairCStatEvento,
  extrairXMotivo,
  classificarResultado,
  TP_EVENTO_CANCELAMENTO
};
