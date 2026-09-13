/**
 * Consulta Status do Serviço — fluxo LEGADO (soapClient / axios direto).
 * Usado como fallback automático pela Plataforma Fiscal (Sprint F5).
 *
 * @module services/fiscal/statusServicoLegado
 */

const axios = require('axios');
const https = require('https');
const { carregarCertificadoPfx } = require('./certificateService');

const NS_STATUS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4';
const ACTION_STATUS = `${NS_STATUS}/nfeStatusServicoNF`;

/**
 * Monta XML consStatServ + envelope SOAP 1.2.
 * @param {{ tpAmb: number|string, cUF: string, versao?: string }} params
 * @returns {string}
 */
function montarEnvelopeStatusServico({ tpAmb, cUF, versao = '4.00' }) {
  const cons =
    `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<cUF>${cUF}</cUF>` +
      `<xServ>STATUS</xServ>` +
    `</consStatServ>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Header>` +
        `<nfeCabecMsg xmlns="${NS_STATUS}">` +
          `<cUF>${cUF}</cUF>` +
          `<versaoDados>${versao}</versaoDados>` +
        `</nfeCabecMsg>` +
      `</soap12:Header>` +
      `<soap12:Body>` +
        `<nfeDadosMsg xmlns="${NS_STATUS}">` +
          `${cons}` +
        `</nfeDadosMsg>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/**
 * Envia consulta de status via fluxo legado (axios direto).
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.envelope
 * @param {string} params.certificadoPath
 * @param {string} params.certificadoSenha
 * @param {number} [params.timeoutMs=30000]
 * @param {Function} [params.httpClient] Injeção para testes
 * @returns {Promise<{ success: boolean, body: string|null, statusCode: number|null, message?: string, tempo: number }>}
 */
async function enviarStatusServicoLegado(params) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  const {
    url,
    envelope,
    certificadoPath,
    certificadoSenha,
    timeoutMs = 30000,
    httpClient = null
  } = params;

  if (!url) {
    return {
      success: false,
      body: null,
      statusCode: null,
      message: 'URL de status não configurada (legado).',
      tempo: elapsedMs()
    };
  }

  try {
    if (typeof httpClient === 'function') {
      const result = await httpClient({
        url,
        envelope,
        certificadoPath,
        certificadoSenha,
        timeoutMs
      });
      return {
        success: true,
        body: result.body,
        statusCode: result.statusCode || 200,
        tempo: elapsedMs()
      };
    }

    if (!certificadoPath) {
      return {
        success: false,
        body: null,
        statusCode: null,
        message: 'Certificado não configurado (legado).',
        tempo: elapsedMs()
      };
    }

    const certificado = carregarCertificadoPfx(certificadoPath, certificadoSenha);
    const host = new URL(url).hostname;
    const httpsAgent = new https.Agent({
      key: certificado.privateKeyPem,
      cert: certificado.certBundlePem || certificado.certPem,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      keepAlive: false,
      servername: host
    });

    const response = await axios.post(url, envelope, {
      httpsAgent,
      proxy: false,
      timeout: timeoutMs,
      responseType: 'text',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      transitional: { forcedJSONParsing: false },
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${ACTION_STATUS}"`,
        Accept: 'application/soap+xml, text/xml, */*',
        'User-Agent': 'CDGESTAO-STATUS-LEGADO/1.0'
      }
    });

    return {
      success: true,
      body: response.data,
      statusCode: response.status,
      tempo: elapsedMs()
    };
  } catch (error) {
    return {
      success: false,
      body: error.response?.data || null,
      statusCode: error.response?.status || null,
      message: error.message || String(error),
      code: error.code || null,
      tempo: elapsedMs()
    };
  }
}

module.exports = {
  montarEnvelopeStatusServico,
  enviarStatusServicoLegado,
  NS_STATUS,
  ACTION_STATUS
};
