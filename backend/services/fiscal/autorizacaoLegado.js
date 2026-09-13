/**
 * Autorização NFC-e — fluxo LEGADO (soapClient / axios direto).
 * Isolado para fallback da Plataforma Fiscal (Sprint F10).
 *
 * Sem regras de DB/UI — apenas transporte SOAP do lote.
 *
 * @module services/fiscal/autorizacaoLegado
 */

const {
  montarSoapEnvelop,
  enviarLote
} = require('./soapClient');

const NS_AUTORIZACAO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';
const ACTION_AUTORIZACAO = `${NS_AUTORIZACAO}/nfeAutorizacaoLote`;

/**
 * @param {number} ambiente 1=prod 2=hom
 * @returns {string}
 */
function getAutorizacaoUrl(ambiente) {
  return Number(ambiente) === 1
    ? 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx'
    : 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
}

/**
 * Monta envelope SOAP técnico de autorização a partir do lote (enviNFe).
 *
 * @param {object} params
 * @param {string} params.loteXml
 * @param {string} [params.cUF='23']
 * @param {string} [params.versaoDados='4.00']
 * @returns {string}
 */
function montarEnvelopeAutorizacao(params = {}) {
  const loteXml = params.loteXml || params.envelopeLote || '';
  const cUF = String(params.cUF || '23').replace(/\D/g, '').padStart(2, '0');
  const versaoDados = params.versaoDados || params.versao || '4.00';
  return montarSoapEnvelop(loteXml, cUF, versaoDados);
}

/**
 * Envia autorização via fluxo legado (soapClient.enviarLote).
 * Aceita httpClient injetado para testes sem HTTP real.
 *
 * @param {object} params
 * @returns {Promise<object>}
 */
async function enviarAutorizacaoLegado(params = {}) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  const ambiente = Number(params.ambiente) === 1 ? 1 : 2;
  const url = params.url || getAutorizacaoUrl(ambiente);
  const versao = params.versaoDados || params.versao || '4.00';
  const cUF = String(params.cUF || '23').replace(/\D/g, '').padStart(2, '0');
  const loteXml = params.loteXml || '';

  const xmlStarted = process.hrtime.bigint();
  const envelope = params.envelope || (loteXml
    ? montarEnvelopeAutorizacao({ loteXml, cUF, versaoDados: versao })
    : null);
  const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

  if (!url) {
    return {
      success: false,
      body: null,
      raw: null,
      status: 'configuracao_pendente',
      statusCode: null,
      message: 'URL de autorização não configurada (legado).',
      endpoint: null,
      namespace: NS_AUTORIZACAO,
      soapAction: ACTION_AUTORIZACAO,
      versao,
      tempoXmlMs,
      tempoSoapMs: 0,
      tempo: elapsedMs()
    };
  }

  try {
    if (typeof params.httpClient === 'function') {
      const soapStarted = process.hrtime.bigint();
      const result = await params.httpClient({
        url,
        envelope: envelope || loteXml,
        loteXml,
        certificadoPath: params.certificadoPath,
        certificadoSenha: params.certificadoSenha,
        timeoutMs: params.timeoutMs || 90000
      });
      const tempoSoapMs = Number(process.hrtime.bigint() - soapStarted) / 1e6;
      const body = result.body || result.raw || null;
      return {
        success: true,
        body,
        raw: body,
        status: 'soap_enviado',
        statusCode: result.statusCode || 200,
        endpoint: url,
        namespace: NS_AUTORIZACAO,
        soapAction: ACTION_AUTORIZACAO,
        versao,
        tempoXmlMs,
        tempoSoapMs,
        tempo: elapsedMs()
      };
    }

    const soapStarted = process.hrtime.bigint();
    const result = await enviarLote({
      url,
      loteXml,
      certificadoPath: params.certificadoPath,
      certificadoSenha: params.certificadoSenha,
      cUF,
      versaoDados: versao
    });
    const tempoSoapMs = Number(process.hrtime.bigint() - soapStarted) / 1e6;
    const body = result.raw || null;

    return {
      success: Boolean(result.success),
      body,
      raw: body,
      status: result.status || (result.success ? 'soap_enviado' : 'erro_transmissao'),
      statusCode: result.success ? 200 : null,
      message: result.message || null,
      code: result.code || null,
      endpoint: url,
      namespace: NS_AUTORIZACAO,
      soapAction: ACTION_AUTORIZACAO,
      versao,
      tempoXmlMs,
      tempoSoapMs,
      tempo: elapsedMs()
    };
  } catch (error) {
    return {
      success: false,
      body: error.response?.data || null,
      raw: error.response?.data || null,
      status: 'erro_transmissao',
      statusCode: error.response?.status || null,
      message: error.message || String(error),
      code: error.code || null,
      endpoint: url,
      namespace: NS_AUTORIZACAO,
      soapAction: ACTION_AUTORIZACAO,
      versao,
      tempoXmlMs,
      tempoSoapMs: 0,
      tempo: elapsedMs()
    };
  }
}

module.exports = {
  montarEnvelopeAutorizacao,
  enviarAutorizacaoLegado,
  getAutorizacaoUrl,
  NS_AUTORIZACAO,
  ACTION_AUTORIZACAO
};
