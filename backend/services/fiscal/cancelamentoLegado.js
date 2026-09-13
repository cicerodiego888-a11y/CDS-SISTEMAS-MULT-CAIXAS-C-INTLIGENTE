/**
 * Cancelamento NFC-e — fluxo LEGADO (axios / RecepcaoEvento direto).
 * Isolado para fallback da Plataforma Fiscal (Sprint F9).
 *
 * Evento 110111. Sem regras de DB/UI — apenas transporte SOAP.
 *
 * @module services/fiscal/cancelamentoLegado
 */

const axios = require('axios');
const https = require('https');
const { carregarCertificadoPfx } = require('./certificateService');

const NS_EVENTO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const ACTION_EVENTO = `${NS_EVENTO}/nfeRecepcaoEvento`;
const TP_EVENTO_CANCELAMENTO = '110111';

/**
 * @param {number} ambiente 1=prod 2=hom
 * @returns {string}
 */
function getCancelamentoUrl(ambiente) {
  return Number(ambiente) === 1
    ? 'https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
    : 'https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx';
}

/**
 * Monta envelope SOAP técnico de cancelamento (sem assinatura — infraestrutura).
 * A assinatura real permanece em cancelarNfce.js / signer.
 *
 * @param {object} params
 * @returns {string}
 */
function montarEnvelopeCancelamento(params = {}) {
  const {
    tpAmb = 2,
    cUF = '23',
    cnpj = '00000000000000',
    chave = '0'.repeat(44),
    protocolo = '000000000000000',
    xJust = 'Cancelamento de teste infraestrutura',
    nSeqEvento = 1,
    idLote = '1',
    dhEvento = new Date().toISOString()
  } = params;

  const chaveLimpa = String(chave).replace(/\D/g, '').padStart(44, '0').slice(0, 44);
  const id = `ID${TP_EVENTO_CANCELAMENTO}${chaveLimpa}${String(nSeqEvento).padStart(2, '0')}`;

  const evento =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<infEvento Id="${id}">` +
        `<cOrgao>${cUF}</cOrgao>` +
        `<tpAmb>${tpAmb}</tpAmb>` +
        `<CNPJ>${String(cnpj).replace(/\D/g, '')}</CNPJ>` +
        `<chNFe>${chaveLimpa}</chNFe>` +
        `<dhEvento>${dhEvento}</dhEvento>` +
        `<tpEvento>${TP_EVENTO_CANCELAMENTO}</tpEvento>` +
        `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
        `<verEvento>1.00</verEvento>` +
        `<detEvento versao="1.00">` +
          `<descEvento>Cancelamento</descEvento>` +
          `<nProt>${protocolo}</nProt>` +
          `<xJust>${escapeXml(xJust)}</xJust>` +
        `</detEvento>` +
      `</infEvento>` +
    `</evento>`;

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<idLote>${idLote}</idLote>` +
      evento +
    `</envEvento>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Header>` +
        `<nfeCabecMsg xmlns="${NS_EVENTO}">` +
          `<cUF>${cUF}</cUF>` +
          `<versaoDados>1.00</versaoDados>` +
        `</nfeCabecMsg>` +
      `</soap12:Header>` +
      `<soap12:Body>` +
        `<nfeDadosMsg xmlns="${NS_EVENTO}">` +
          `${envEvento}` +
        `</nfeDadosMsg>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/**
 * Envia cancelamento via fluxo legado (axios direto).
 *
 * @param {object} params
 * @returns {Promise<object>}
 */
async function enviarCancelamentoLegado(params = {}) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  const ambiente = Number(params.ambiente) === 1 ? 1 : 2;
  const url = params.url || getCancelamentoUrl(ambiente);
  const versao = params.versao || '1.00';
  const cUF = String(params.cUF || '23').replace(/\D/g, '').padStart(2, '0');

  const xmlStarted = process.hrtime.bigint();
  const envelope = params.envelope || montarEnvelopeCancelamento({
    tpAmb: ambiente,
    cUF,
    cnpj: params.cnpj,
    chave: params.chave,
    protocolo: params.protocolo,
    xJust: params.xJust,
    nSeqEvento: params.nSeqEvento,
    idLote: params.idLote
  });
  const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

  if (!url) {
    return {
      success: false,
      body: null,
      statusCode: null,
      message: 'URL de cancelamento não configurada (legado).',
      endpoint: null,
      namespace: NS_EVENTO,
      soapAction: ACTION_EVENTO,
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
        namespace: NS_EVENTO,
        soapAction: ACTION_EVENTO,
        versao,
        tempoXmlMs,
        tempoSoapMs,
        tempo: elapsedMs()
      };
    }

    if (!params.certificadoPath && !params.httpsAgent) {
      return {
        success: false,
        body: null,
        statusCode: null,
        message: 'Certificado não configurado (legado).',
        endpoint: url,
        namespace: NS_EVENTO,
        soapAction: ACTION_EVENTO,
        versao,
        tempoXmlMs,
        tempoSoapMs: 0,
        tempo: elapsedMs()
      };
    }

    let httpsAgent = params.httpsAgent || null;
    if (!httpsAgent) {
      const certificado = carregarCertificadoPfx(params.certificadoPath, params.certificadoSenha);
      const host = new URL(url).hostname;
      httpsAgent = new https.Agent({
        key: certificado.privateKeyPem,
        cert: certificado.certBundlePem || certificado.certPem,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
        keepAlive: false,
        servername: host
      });
    }

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
        'Content-Type': `application/soap+xml; charset=utf-8; action="${ACTION_EVENTO}"`,
        Accept: 'application/soap+xml, text/xml, */*',
        'User-Agent': 'CDGESTAO-CANCELAMENTO-LEGADO/1.0'
      }
    });
    const tempoSoapMs = Number(process.hrtime.bigint() - soapStarted) / 1e6;

    return {
      success: true,
      body: response.data,
      statusCode: response.status,
      endpoint: url,
      namespace: NS_EVENTO,
      soapAction: ACTION_EVENTO,
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
      namespace: NS_EVENTO,
      soapAction: ACTION_EVENTO,
      versao,
      tempoXmlMs,
      tempoSoapMs: 0,
      tempo: elapsedMs()
    };
  }
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  montarEnvelopeCancelamento,
  enviarCancelamentoLegado,
  getCancelamentoUrl,
  NS_EVENTO,
  ACTION_EVENTO,
  TP_EVENTO_CANCELAMENTO
};
