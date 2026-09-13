/**
 * Manifestação do Destinatário — fluxo LEGADO (axios / RecepcaoEvento direto).
 * Isolado para fallback da Plataforma Fiscal (Sprint F7 / RC6.9).
 *
 * Endpoint vem exclusivamente do Registry oficial (Ambiente Nacional).
 * Sem URLs próprias.
 *
 * Infraestrutura apenas — sem regras comerciais, UI ou persistência.
 *
 * @module services/fiscal/manifestacaoLegado
 */

const axios = require('axios');
const https = require('https');
const { carregarCertificadoPfx } = require('./certificateService');
const {
  OperationType,
  getManifestacaoEventoCode
} = require('./core/OperationType');
const { EnvironmentType, fromAmbienteCode } = require('./core/EnvironmentType');
const { ModelType } = require('./core/ModelType');
const { RegistryBuilder, UF_AN, NS, ACTION } = require('./core/RegistryBuilder');

const NS_EVENTO = NS.EVENTO;
const ACTION_EVENTO = ACTION.EVENTO;

/**
 * Resolve URL oficial de Manifestação via Registry (AN).
 * @param {number} ambiente 1=prod 2=hom
 * @returns {string}
 */
function getManifestacaoUrl(ambiente) {
  const env = fromAmbienteCode(ambiente) || EnvironmentType.HOMOLOGACAO;
  const registry = RegistryBuilder.buildOfficial();
  const def = registry.get({
    modelo: ModelType.NFE,
    operacao: OperationType.MANIFESTACAO_CIENCIA,
    ambiente: env,
    uf: UF_AN
  });
  if (!def?.endpoint) {
    throw new Error('Registry oficial sem endpoint de Manifestação (AN).');
  }
  return def.endpoint;
}

/**
 * Monta envelope SOAP técnico de manifestação (sem assinatura — infraestrutura).
 * NT 2016.002: nfeCabecMsg eliminado no layout 4.00 — apenas Body.
 * NT 2020.001: cOrgao = 91 (Ambiente Nacional).
 *
 * @param {object} params
 * @returns {string}
 */
function montarEnvelopeManifestacao(params) {
  const {
    tpAmb = 2,
    cOrgao = '91',
    cnpj = '00000000000000',
    chave = '0'.repeat(44),
    operacao = OperationType.MANIFESTACAO_CIENCIA,
    nSeqEvento = 1,
    xJust = '',
    dhEvento = new Date().toISOString()
  } = params;

  const tpEvento = getManifestacaoEventoCode(operacao) || '210210';
  const chaveLimpa = String(chave).replace(/\D/g, '').padStart(44, '0').slice(0, 44);
  const id = `ID${tpEvento}${chaveLimpa}${String(nSeqEvento).padStart(2, '0')}`;
  const orgao = String(params.cOrgao || cOrgao || '91').replace(/\D/g, '').padStart(2, '0');

  let detEvento =
    `<detEvento versao="1.00">` +
      `<descEvento>${descricaoEvento(tpEvento)}</descEvento>`;
  if (tpEvento === '210240' && xJust) {
    detEvento += `<xJust>${escapeXml(xJust)}</xJust>`;
  }
  detEvento += `</detEvento>`;

  const evento =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<infEvento Id="${id}">` +
        `<cOrgao>${orgao}</cOrgao>` +
        `<tpAmb>${tpAmb}</tpAmb>` +
        `<CNPJ>${String(cnpj).replace(/\D/g, '')}</CNPJ>` +
        `<chNFe>${chaveLimpa}</chNFe>` +
        `<dhEvento>${dhEvento}</dhEvento>` +
        `<tpEvento>${tpEvento}</tpEvento>` +
        `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
        `<verEvento>1.00</verEvento>` +
        detEvento +
      `</infEvento>` +
    `</evento>`;

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<idLote>1</idLote>` +
      evento +
    `</envEvento>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Body>` +
        `<nfeDadosMsg xmlns="${NS_EVENTO}">` +
          `${envEvento}` +
        `</nfeDadosMsg>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function descricaoEvento(tpEvento) {
  switch (String(tpEvento)) {
    case '210200': return 'Confirmacao da Operacao';
    case '210210': return 'Ciencia da Operacao';
    case '210220': return 'Desconhecimento da Operacao';
    case '210240': return 'Operacao nao Realizada';
    default: return 'Manifestacao';
  }
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Envia manifestação via fluxo legado.
 *
 * @param {object} params
 * @returns {Promise<object>}
 */
async function enviarManifestacaoLegado(params) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - started) / 1e6;

  const {
    envelope: envelopeInput = null,
    operacao = OperationType.MANIFESTACAO_CIENCIA,
    ambiente = 2,
    cnpj,
    chave,
    nSeqEvento = 1,
    xJust = '',
    certificadoPath,
    certificadoSenha,
    url = null,
    httpClient = null,
    timeoutMs = 30000
  } = params;

  let endpoint = url;
  try {
    endpoint = endpoint || getManifestacaoUrl(ambiente);
  } catch (error) {
    return {
      success: false,
      body: null,
      statusCode: null,
      message: error.message,
      endpoint: null,
      namespace: NS_EVENTO,
      tempoXmlMs: 0,
      tempoSoapMs: 0,
      tempo: elapsedMs()
    };
  }

  const xmlStarted = process.hrtime.bigint();
  const envelope = envelopeInput || montarEnvelopeManifestacao({
    tpAmb: Number(ambiente) === 1 ? 1 : 2,
    cOrgao: '91',
    cnpj,
    chave,
    operacao,
    nSeqEvento,
    xJust
  });
  const tempoXmlMs = Number(process.hrtime.bigint() - xmlStarted) / 1e6;

  const soapStarted = process.hrtime.bigint();

  try {
    if (typeof httpClient === 'function') {
      const result = await httpClient({
        url: endpoint,
        envelope,
        certificadoPath,
        certificadoSenha,
        soapAction: ACTION_EVENTO,
        namespace: NS_EVENTO,
        timeoutMs
      });
      return {
        success: true,
        body: result.body,
        statusCode: result.statusCode || 200,
        endpoint,
        namespace: NS_EVENTO,
        soapAction: ACTION_EVENTO,
        versao: '1.00',
        tempoXmlMs,
        tempoSoapMs: Number(process.hrtime.bigint() - soapStarted) / 1e6,
        tempo: elapsedMs()
      };
    }

    if (!certificadoPath) {
      return {
        success: false,
        body: null,
        statusCode: null,
        message: 'Certificado não configurado (legado manifestação).',
        endpoint,
        namespace: NS_EVENTO,
        tempoXmlMs,
        tempoSoapMs: 0,
        tempo: elapsedMs()
      };
    }

    const certificado = carregarCertificadoPfx(certificadoPath, certificadoSenha);
    const host = new URL(endpoint).hostname;
    const httpsAgent = new https.Agent({
      key: certificado.privateKeyPem,
      cert: certificado.certBundlePem || certificado.certPem,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      keepAlive: false,
      servername: host
    });

    const response = await axios.post(endpoint, envelope, {
      httpsAgent,
      proxy: false,
      timeout: timeoutMs,
      responseType: 'text',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      transitional: { forcedJSONParsing: false },
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${ACTION_EVENTO}"`,
        Accept: 'application/soap+xml, text/xml, */*',
        'User-Agent': 'CDGESTAO-MANIFESTACAO-LEGADO/1.0'
      }
    });

    return {
      success: true,
      body: response.data,
      statusCode: response.status,
      endpoint,
      namespace: NS_EVENTO,
      soapAction: ACTION_EVENTO,
      versao: '1.00',
      tempoXmlMs,
      tempoSoapMs: Number(process.hrtime.bigint() - soapStarted) / 1e6,
      tempo: elapsedMs()
    };
  } catch (error) {
    return {
      success: false,
      body: error.response?.data || null,
      statusCode: error.response?.status || null,
      message: error.message || String(error),
      code: error.code || null,
      endpoint,
      namespace: NS_EVENTO,
      soapAction: ACTION_EVENTO,
      versao: '1.00',
      tempoXmlMs,
      tempoSoapMs: Number(process.hrtime.bigint() - soapStarted) / 1e6,
      tempo: elapsedMs()
    };
  }
}

module.exports = {
  getManifestacaoUrl,
  montarEnvelopeManifestacao,
  enviarManifestacaoLegado,
  NS_EVENTO,
  ACTION_EVENTO
};
