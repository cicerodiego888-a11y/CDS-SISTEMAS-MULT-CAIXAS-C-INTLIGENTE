/**
 * Consulta por Chave (Consulta Protocolo) — fluxo LEGADO (axios direto).
 * Isolado para fallback da Plataforma Fiscal (Sprint F8).
 *
 * Nunca misturar com a lógica da plataforma.
 *
 * @module services/fiscal/consultaProtocoloLegado
 */

const axios = require('axios');
const https = require('https');
const { carregarCertificadoPfx } = require('./certificateService');

const NS_CONSULTA = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4';
const ACTION_CONSULTA = `${NS_CONSULTA}/nfeConsultaNF`;

/**
 * @param {number} ambiente 1=prod 2=hom
 * @param {string} [modelo='NFCE'] NFCE|NFE
 * @returns {string}
 */
function getConsultaProtocoloUrl(ambiente, modelo = 'NFCE') {
  const prod = Number(ambiente) === 1;
  const isNfe = String(modelo).toUpperCase() === 'NFE';
  if (isNfe) {
    return prod
      ? 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx'
      : 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx';
  }
  return prod
    ? 'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx'
    : 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx';
}

/**
 * Monta consSitNFe + envelope SOAP 1.2.
 *
 * @param {object} params
 * @param {number|string} params.tpAmb
 * @param {string} params.chave
 * @param {string} [params.cUF='23']
 * @param {string} [params.versao='4.00']
 * @returns {string}
 */
function montarEnvelopeConsultaProtocolo(params) {
  const {
    tpAmb = 2,
    chave = '0'.repeat(44),
    cUF = '23',
    versao = '4.00'
  } = params;

  const chaveLimpa = String(chave).replace(/\D/g, '').padStart(44, '0').slice(0, 44);

  const cons =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<xServ>CONSULTAR</xServ>` +
      `<chNFe>${chaveLimpa}</chNFe>` +
    `</consSitNFe>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Header>` +
        `<nfeCabecMsg xmlns="${NS_CONSULTA}">` +
          `<cUF>${cUF}</cUF>` +
          `<versaoDados>${versao}</versaoDados>` +
        `</nfeCabecMsg>` +
      `</soap12:Header>` +
      `<soap12:Body>` +
        `<nfeDadosMsg xmlns="${NS_CONSULTA}">` +
          `${cons}` +
        `</nfeDadosMsg>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/**
 * Envia consulta por chave via fluxo legado (axios direto).
 *
 * @param {object} params
 * @param {string} [params.url]
 * @param {string} [params.envelope]
 * @param {number|string} [params.ambiente=2]
 * @param {string} [params.modelo='NFCE']
 * @param {string} [params.chave]
 * @param {string} [params.cUF='23']
 * @param {string} [params.versao='4.00']
 * @param {string} [params.certificadoPath]
 * @param {string} [params.certificadoSenha]
 * @param {number} [params.timeoutMs=30000]
 * @param {Function} [params.httpClient]
 * @returns {Promise<object>}
 */
async function enviarConsultaProtocoloLegado(params = {}) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  const ambiente = Number(params.ambiente) === 1 ? 1 : 2;
  const modelo = params.modelo || 'NFCE';
  const url = params.url || getConsultaProtocoloUrl(ambiente, modelo);
  const versao = params.versao || '4.00';
  const cUF = String(params.cUF || '23').replace(/\D/g, '').padStart(2, '0');

  const xmlStarted = process.hrtime.bigint();
  const envelope = params.envelope || montarEnvelopeConsultaProtocolo({
    tpAmb: ambiente,
    chave: params.chave,
    cUF,
    versao
  });
  const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

  if (!url) {
    return {
      success: false,
      body: null,
      statusCode: null,
      message: 'URL de consulta protocolo não configurada (legado).',
      endpoint: null,
      namespace: NS_CONSULTA,
      soapAction: ACTION_CONSULTA,
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
        envelope,
        certificadoPath: params.certificadoPath,
        certificadoSenha: params.certificadoSenha,
        timeoutMs: params.timeoutMs || 30000
      });
      const tempoSoapMs = Number(process.hrtime.bigint() - soapStarted) / 1e6;
      return {
        success: true,
        body: result.body,
        statusCode: result.statusCode || 200,
        endpoint: url,
        namespace: NS_CONSULTA,
        soapAction: ACTION_CONSULTA,
        versao,
        tempoXmlMs,
        tempoSoapMs,
        tempo: elapsedMs()
      };
    }

    if (!params.certificadoPath) {
      return {
        success: false,
        body: null,
        statusCode: null,
        message: 'Certificado não configurado (legado).',
        endpoint: url,
        namespace: NS_CONSULTA,
        soapAction: ACTION_CONSULTA,
        versao,
        tempoXmlMs,
        tempoSoapMs: 0,
        tempo: elapsedMs()
      };
    }

    const certificado = carregarCertificadoPfx(params.certificadoPath, params.certificadoSenha);
    const host = new URL(url).hostname;
    const httpsAgent = new https.Agent({
      key: certificado.privateKeyPem,
      cert: certificado.certBundlePem || certificado.certPem,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      keepAlive: false,
      servername: host
    });

    const soapStarted = process.hrtime.bigint();
    const response = await axios.post(url, envelope, {
      httpsAgent,
      proxy: false,
      timeout: params.timeoutMs || 30000,
      responseType: 'text',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      transitional: { forcedJSONParsing: false },
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${ACTION_CONSULTA}"`,
        Accept: 'application/soap+xml, text/xml, */*',
        'User-Agent': 'CDGESTAO-CONSULTA-PROTOCOLO-LEGADO/1.0'
      }
    });
    const tempoSoapMs = Number(process.hrtime.bigint() - soapStarted) / 1e6;

    return {
      success: true,
      body: response.data,
      statusCode: response.status,
      endpoint: url,
      namespace: NS_CONSULTA,
      soapAction: ACTION_CONSULTA,
      versao,
      tempoXmlMs,
      tempoSoapMs,
      tempo: elapsedMs()
    };
  } catch (error) {
    return {
      success: false,
      body: error.response?.data || null,
      statusCode: error.response?.status || null,
      message: error.message || String(error),
      code: error.code || null,
      endpoint: url,
      namespace: NS_CONSULTA,
      soapAction: ACTION_CONSULTA,
      versao,
      tempoXmlMs,
      tempoSoapMs: 0,
      tempo: elapsedMs()
    };
  }
}

module.exports = {
  montarEnvelopeConsultaProtocolo,
  enviarConsultaProtocoloLegado,
  getConsultaProtocoloUrl,
  NS_CONSULTA,
  ACTION_CONSULTA
};
