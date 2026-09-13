/**
 * Manifestação do Destinatário — runtime da Plataforma Fiscal (Sprint F7 / RC1.1).
 *
 * Fluxo:
 *   Manifestação → FiscalWebServices → UrlResolver → Registry
 *               → TransportFactory → SoapTransport → SEFAZ
 *
 * Fallback automático → manifestacaoLegado.
 *
 * Infraestrutura apenas — sem UI, workflow, persistência ou regras comerciais.
 *
 * @module services/fiscal/manifestacaoRuntime
 */

const { FiscalWebServices } = require('./core/FiscalWebServices');
const { ModelType } = require('./core/ModelType');
const {
  OperationType,
  getManifestacaoEventoCode
} = require('./core/OperationType');
const { EnvironmentType, fromAmbienteCode } = require('./core/EnvironmentType');
const { ResolutionSource } = require('./core/ResolutionSource');
const { UF_AN } = require('./core/RegistryBuilder');
const { logFiscalRuntime } = require('./core/FiscalRuntimeLog');
const { buildRuntimeResult } = require('./core/FiscalRuntimeResult');
const {
  montarEnvelopeManifestacao,
  enviarManifestacaoLegado,
  getManifestacaoUrl,
  NS_EVENTO,
  ACTION_EVENTO
} = require('./manifestacaoLegado');
const { ManifestacaoMetrics } = require('./manifestacaoMetrics');

const OPERACOES_MANIFESTACAO = Object.freeze([
  OperationType.MANIFESTACAO_CIENCIA,
  OperationType.MANIFESTACAO_CONFIRMACAO,
  OperationType.MANIFESTACAO_DESCONHECIMENTO,
  OperationType.MANIFESTACAO_NAO_REALIZADA
]);

const defaultMetrics = new ManifestacaoMetrics();

/**
 * @param {object} [options]
 * @returns {object}
 */
function createManifestacaoRuntime(options = {}) {
  const platform = options.platform || new FiscalWebServices();
  const metrics = options.metrics || defaultMetrics;
  const legadoSender = options.legadoSender || enviarManifestacaoLegado;

  /**
   * Envia evento de manifestação via plataforma + fallback.
   *
   * @param {object} input
   * @param {string} input.operacao MANIFESTACAO_*
   * @param {string} [input.chave]
   * @param {number|string} [input.ambiente]
   * @param {string} [input.uf] Ignorado — Manifestação sempre resolve em AN (RC6.9)
   * @param {string} [input.cUF] Apenas legado de assinatura; cOrgao do evento é 91
   * @param {string} [input.cnpj]
   * @param {string} [input.certificadoPath]
   * @param {string} [input.certificadoSenha]
   * @param {string} [input.envelope] Envelope pronto (opcional)
   * @param {string} [input.xJust]
   * @param {number} [input.nSeqEvento=1]
   * @returns {Promise<object>}
   */
  async function enviarManifestacao(input = {}) {
    const totalStarted = process.hrtime.bigint();
    const nowMs = () => Number(process.hrtime.bigint() - totalStarted) / 1e6;

    const operacao = normalizarOperacao(input.operacao);
    const ambiente = normalizeAmbiente(input.ambiente);
    const ambienteCode = ambiente === EnvironmentType.PRODUCAO ? 1 : 2;
    // RC6.9 — Manifestação do Destinatário: autorizador oficial = Ambiente Nacional.
    const uf = UF_AN;
    const warnings = [];
    const logOp = operacao || 'MANIFESTACAO';

    if (!operacao || !OPERACOES_MANIFESTACAO.includes(operacao)) {
      const fail = buildRuntimeResult({
        success: false,
        source: null,
        operacao: operacao || null,
        modelo: ModelType.NFE,
        ambiente,
        uf,
        error: 'operacao de manifestação inválida. Use MANIFESTACAO_CIENCIA|CONFIRMACAO|DESCONHECIMENTO|NAO_REALIZADA.',
        fallbackUtilizado: false,
        tempoResolverMs: 0,
        tempoTransporteMs: 0,
        tempoXmlMs: 0,
        tempoSoapMs: 0,
        tempoPlataformaMs: 0,
        tempoLegadoMs: 0,
        tempoTotalMs: nowMs(),
        retries: 0
      });
      metrics.record(fail);
      return fail;
    }

    const xmlStarted = process.hrtime.bigint();
    const envelope = input.envelope || montarEnvelopeManifestacao({
      tpAmb: ambienteCode,
      cOrgao: '91',
      cnpj: input.cnpj || '00000000000000',
      chave: input.chave || '0'.repeat(44),
      operacao,
      nSeqEvento: input.nSeqEvento || 1,
      xJust: input.xJust || ''
    });
    const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

    const resolverStarted = process.hrtime.bigint();
    const resolution = platform.resolve({
      modelo: ModelType.NFE,
      operacao,
      ambiente,
      uf: UF_AN,
      versao: '1.00'
    });
    const tempoResolverMs = Number(process.hrtime.bigint() - resolverStarted) / 1e6;

    const def = resolution.definition || null;
    const tpEvento = getManifestacaoEventoCode(operacao);
    logFiscalRuntime(logOp, {
      Ambiente: ambiente,
      UF: uf,
      Modelo: ModelType.NFE,
      Operacao: operacao,
      tpEvento,
      Registry: resolution.success,
      Endpoint: def?.endpoint || null,
      Namespace: def?.namespace || NS_EVENTO,
      Versao: def?.versao || '1.00',
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
        operacao,
        modelo: ModelType.NFE
      });

      const transportStarted = process.hrtime.bigint();
      const transportResponse = await transport.send(request);
      tempoTransporteMs = Number(process.hrtime.bigint() - transportStarted) / 1e6;
      tempoSoapMs = tempoTransporteMs;
      tempoPlataformaMs = nowMs();
      retries = Math.max(0, (transportResponse.attempts || 1) - 1);

      logFiscalRuntime(logOp, {
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
          operacao,
          tpEvento,
          modelo: ModelType.NFE,
          endpoint: def.endpoint,
          namespace: def.namespace || NS_EVENTO,
          soapAction: def.soapAction || ACTION_EVENTO,
          versao: def.versao || '1.00',
          ambiente,
          uf,
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
          retries
        });
        logFiscalRuntime(logOp, {
          Resultado: 'OK',
          'Tempo Total': result.tempoTotalMs,
          Fallback: false
        });
        metrics.record(result);
        return result;
      }

      warnings.push({
        code: 'PLATFORM_TRANSPORT_FAILED',
        message: transportResponse.error || 'Falha no SoapTransport da manifestação.'
      });
    } else {
      warnings.push({
        code: 'PLATFORM_RESOLVE_FAILED',
        message: resolution.error || 'Falha ao resolver contrato de Manifestação.'
      });
    }

    const legadoUrl = def?.endpoint || getManifestacaoUrl(ambienteCode);
    const legadoStarted = process.hrtime.bigint();
    const legado = await legadoSender({
      envelope,
      operacao,
      ambiente: ambienteCode,
      cnpj: input.cnpj,
      chave: input.chave,
      certificadoPath: input.certificadoPath,
      certificadoSenha: input.certificadoSenha,
      url: legadoUrl,
      httpClient: input.legadoHttpClient || null
    });
    tempoLegadoMs = Number(process.hrtime.bigint() - legadoStarted) / 1e6;

    warnings.push({
      code: 'FALLBACK',
      message: 'Fluxo legado (manifestacaoLegado) executado após falha da plataforma.'
    });

    const result = buildRuntimeResult({
      success: Boolean(legado.success),
      source: ResolutionSource.FALLBACK,
      resolutionSource: resolution.source || null,
      operacao,
      tpEvento,
      modelo: ModelType.NFE,
      endpoint: legado.endpoint || legadoUrl,
      namespace: legado.namespace || NS_EVENTO,
      soapAction: legado.soapAction || ACTION_EVENTO,
      versao: legado.versao || '1.00',
      ambiente,
      uf,
      body: legado.body,
      statusCode: legado.statusCode,
      error: legado.success ? null : (legado.message || 'Falha no fluxo legado de manifestação.'),
      warnings,
      tempoResolverMs,
      tempoTransporteMs,
      tempoXmlMs: tempoXmlMs + (Number(legado.tempoXmlMs) || 0),
      tempoSoapMs: Number(legado.tempoSoapMs) || 0,
      tempoPlataformaMs,
      tempoLegadoMs,
      tempoTotalMs: nowMs(),
      fallbackUtilizado: true,
      retries
    });

    logFiscalRuntime(logOp, {
      'Tempo Legado': tempoLegadoMs,
      'Tempo Total': result.tempoTotalMs,
      Fallback: true,
      Endpoint: result.endpoint,
      Resultado: result.success ? 'OK' : 'ERRO',
      Retry: retries,
      'Motivo fallback': warnings.map((w) => w.code).join(',')
    });

    metrics.record(result);
    return result;
  }

  return {
    enviarManifestacao,
    getMetrics: () => metrics,
    getPlatform: () => platform,
    OPERACOES_MANIFESTACAO
  };
}

function normalizarOperacao(operacao) {
  if (!operacao) return null;
  if (OPERACOES_MANIFESTACAO.includes(operacao)) return operacao;
  if (operacao === OperationType.MANIFESTACAO) {
    return null; // exige subtipo explícito
  }
  return operacao;
}

function normalizeAmbiente(ambiente) {
  if (ambiente === EnvironmentType.PRODUCAO || ambiente === EnvironmentType.HOMOLOGACAO) {
    return ambiente;
  }
  const fromCode = fromAmbienteCode(ambiente);
  return fromCode || EnvironmentType.HOMOLOGACAO;
}

const runtimePadrao = createManifestacaoRuntime();

module.exports = {
  createManifestacaoRuntime,
  enviarManifestacao: runtimePadrao.enviarManifestacao,
  getManifestacaoMetrics: () => runtimePadrao.getMetrics(),
  ManifestacaoMetrics,
  OPERACOES_MANIFESTACAO,
  montarEnvelopeManifestacao
};
