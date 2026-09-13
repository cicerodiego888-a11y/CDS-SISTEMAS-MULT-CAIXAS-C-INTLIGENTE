/**
 * Helper de resultado padronizado dos runtimes (RC1.1).
 * Não altera regras fiscais — apenas shape de telemetria.
 *
 * @module services/fiscal/core/FiscalRuntimeResult
 */

/**
 * @param {object} partial
 * @returns {object}
 */
function buildRuntimeResult(partial = {}) {
  return {
    success: Boolean(partial.success),
    source: partial.source ?? null,
    resolutionSource: partial.resolutionSource ?? null,
    operacao: partial.operacao ?? null,
    modelo: partial.modelo ?? null,
    ambiente: partial.ambiente ?? null,
    uf: partial.uf ?? null,
    endpoint: partial.endpoint ?? null,
    namespace: partial.namespace ?? null,
    soapAction: partial.soapAction ?? null,
    versao: partial.versao ?? null,
    body: partial.body ?? null,
    raw: partial.raw ?? partial.body ?? null,
    status: partial.status ?? null,
    statusCode: partial.statusCode ?? null,
    error: partial.error ?? null,
    message: partial.message ?? null,
    code: partial.code ?? null,
    warnings: Array.isArray(partial.warnings) ? partial.warnings : [],
    tempoResolverMs: Number(partial.tempoResolverMs) || 0,
    tempoTransporteMs: Number(partial.tempoTransporteMs) || 0,
    tempoXmlMs: Number(partial.tempoXmlMs) || 0,
    tempoSoapMs: Number(partial.tempoSoapMs) || 0,
    tempoPlataformaMs: Number(partial.tempoPlataformaMs) || 0,
    tempoLegadoMs: Number(partial.tempoLegadoMs) || 0,
    tempoTotalMs: Number(partial.tempoTotalMs) || 0,
    fallbackUtilizado: Boolean(partial.fallbackUtilizado),
    retries: Number(partial.retries) || 0,
    cStat: partial.cStat ?? null,
    xMotivo: partial.xMotivo ?? null,
    resultado: partial.resultado ?? null,
    ...partial
  };
}

module.exports = {
  buildRuntimeResult
};
