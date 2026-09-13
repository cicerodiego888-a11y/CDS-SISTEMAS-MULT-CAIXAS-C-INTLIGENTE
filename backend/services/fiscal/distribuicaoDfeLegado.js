/**
 * Distribuição DF-e — fluxo LEGADO (soapClient / axios direto).
 * Isolado para fallback automático da Plataforma Fiscal (Sprint F6).
 * URLs SOAP vêm exclusivamente do Registry (ENDPOINTS.DFE).
 *
 * @module services/fiscal/distribuicaoDfeLegado
 */

const { montarSoapDFe, enviarSoapDFe } = require('./soapClient');
const { ENDPOINTS } = require('./core/RegistryBuilder');
const { EnvironmentType } = require('./core/EnvironmentType');

const NS_DFE = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const ACTION_DFE = `${NS_DFE}/nfeDistDFeInteresse`;

/**
 * URLs oficiais Ambiente Nacional (via Registry).
 * @param {number} ambiente 1=prod 2=hom
 * @returns {string}
 */
function getDfeUrl(ambiente) {
  const key = Number(ambiente) === 1
    ? EnvironmentType.PRODUCAO
    : EnvironmentType.HOMOLOGACAO;
  return ENDPOINTS.DFE[key];
}

/**
 * Envia consulta DF-e via fluxo legado.
 *
 * @param {object} params
 * @param {string} params.xmlConsulta distDFeInt (sem envelope)
 * @param {string} params.certificadoPath
 * @param {string} params.certificadoSenha
 * @param {number} params.ambiente
 * @param {string} [params.cUF='23']
 * @param {string} [params.url] Override de endpoint
 * @param {Function} [params.httpClient] Injeção para testes
 * @returns {Promise<object>}
 */
async function enviarDistribuicaoDfeLegado(params) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  const {
    xmlConsulta,
    certificadoPath,
    certificadoSenha,
    ambiente,
    cUF = '23',
    url = null,
    httpClient = null
  } = params;

  const endpoint = url || getDfeUrl(ambiente);

  if (!xmlConsulta) {
    return {
      success: false,
      body: null,
      statusCode: null,
      message: 'xmlConsulta DF-e é obrigatório (legado).',
      endpoint,
      namespace: NS_DFE,
      tempoXmlMs: 0,
      tempoSoapMs: 0,
      tempo: elapsedMs()
    };
  }

  const xmlStarted = process.hrtime.bigint();
  const envelope = montarSoapDFe(xmlConsulta, cUF, '1.01');
  const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

  const soapStarted = process.hrtime.bigint();

  try {
    if (typeof httpClient === 'function') {
      const result = await httpClient({
        url: endpoint,
        envelope,
        certificadoPath,
        certificadoSenha,
        soapAction: ACTION_DFE,
        namespace: NS_DFE
      });
      return {
        success: true,
        body: result.body,
        statusCode: result.statusCode || 200,
        endpoint,
        namespace: NS_DFE,
        soapAction: ACTION_DFE,
        tempoXmlMs,
        tempoSoapMs: Number(process.hrtime.bigint() - soapStarted) / 1e6,
        tempo: elapsedMs()
      };
    }

    const body = await enviarSoapDFe(
      envelope,
      certificadoPath,
      certificadoSenha,
      endpoint
    );

    return {
      success: true,
      body,
      statusCode: 200,
      endpoint,
      namespace: NS_DFE,
      soapAction: ACTION_DFE,
      tempoXmlMs,
      tempoSoapMs: Number(process.hrtime.bigint() - soapStarted) / 1e6,
      tempo: elapsedMs()
    };
  } catch (error) {
    return {
      success: false,
      body: typeof error.message === 'string' && error.message.includes('<')
        ? error.message
        : null,
      statusCode: null,
      message: error.message || String(error),
      endpoint,
      namespace: NS_DFE,
      soapAction: ACTION_DFE,
      tempoXmlMs,
      tempoSoapMs: Number(process.hrtime.bigint() - soapStarted) / 1e6,
      tempo: elapsedMs()
    };
  }
}

module.exports = {
  getDfeUrl,
  enviarDistribuicaoDfeLegado,
  montarSoapDFe,
  NS_DFE,
  ACTION_DFE
};
