'use strict';

const xml2js = require('xml2js');
const { obterXmlAutorizadoNota } = require('./nfceXmlAutorizado');

function erroFiscal(code, message) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = 409;
  return err;
}

function localName(name) {
  return String(name || '').split(':').pop().toLowerCase();
}

function asNodes(value) {
  return Array.isArray(value) ? value : [value];
}

function directNodes(parent, name) {
  const found = [];
  if (!parent || typeof parent !== 'object') return found;
  for (const [key, value] of Object.entries(parent)) {
    if (key === '$' || key === '_') continue;
    if (localName(key) === String(name).toLowerCase()) found.push(...asNodes(value));
  }
  return found;
}

function findNodes(value, name, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) findNodes(item, name, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;

  for (const [key, child] of Object.entries(value)) {
    if (key === '$' || key === '_') continue;
    const nodes = asNodes(child);
    if (localName(key) === String(name).toLowerCase()) found.push(...nodes);
    for (const node of nodes) findNodes(node, name, found);
  }
  return found;
}

function parseXml(xml, code) {
  let parsed = null;
  let parseError = null;
  new xml2js.Parser({
    strict: true,
    explicitArray: true,
    trim: true,
    normalize: false,
    attrkey: '$',
    charkey: '_'
  }).parseString(String(xml || '').replace(/^\uFEFF/, '').trim(), (err, result) => {
    parseError = err || null;
    parsed = result || null;
  });
  if (parseError || !parsed) throw erroFiscal(code, 'XML ausente ou malformado.');
  return parsed;
}

function textValue(node, name, code) {
  const nodes = directNodes(node, name);
  if (nodes.length !== 1) {
    throw erroFiscal(code, `Campo ${name} ausente ou duplicado.`);
  }
  const value = nodes[0] && typeof nodes[0] === 'object'
    && Object.prototype.hasOwnProperty.call(nodes[0], '_')
    ? nodes[0]._
    : nodes[0];
  const text = String(value == null ? '' : value).trim();
  if (!text) throw erroFiscal(code, `Campo ${name} vazio.`);
  return text;
}

function digestBytes(value, code, label) {
  const base64 = String(value || '').replace(/\s+/g, '');
  if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw erroFiscal(code, `${label} ausente ou inválido.`);
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.toString('base64') !== base64) {
    throw erroFiscal(code, `${label} ausente ou inválido.`);
  }
  return bytes;
}

function validarDigValXmlAssinado(xmlAssinado, xmlProcessado) {
  const parsedSigned = parseXml(xmlAssinado, 'XML_ASSINADO_MALFORMADO');
  const nfeNodes = findNodes(parsedSigned, 'NFe');
  if (nfeNodes.length !== 1) {
    throw erroFiscal('XML_ASSINADO_INVALIDO', 'XML assinado deve conter uma única NFe.');
  }
  const signatures = findNodes(nfeNodes[0], 'Signature');
  if (signatures.length !== 1) {
    throw erroFiscal('ASSINATURA_AUSENTE', 'XML transmitido não contém uma assinatura única.');
  }
  const digestValues = findNodes(signatures[0], 'DigestValue');
  if (digestValues.length !== 1) {
    throw erroFiscal('DIGEST_VALUE_AUSENTE', 'Assinatura não contém um único DigestValue.');
  }
  const digestValue = textValue(
    { DigestValue: digestValues },
    'DigestValue',
    'DIGEST_VALUE_AUSENTE'
  );
  const expectedDigest = digestBytes(digestValue, 'DIGEST_VALUE_INVALIDO', 'DigestValue');

  const parsedProcessed = parseXml(xmlProcessado, 'NFE_PROC_MALFORMADO');
  const procNodes = findNodes(parsedProcessed, 'nfeProc');
  if (procNodes.length !== 1) {
    throw erroFiscal('NFE_PROC_INVALIDO', 'XML autorizado deve conter um único nfeProc.');
  }
  const protNodes = directNodes(procNodes[0], 'protNFe');
  if (protNodes.length !== 1) {
    throw erroFiscal('NFE_PROC_INVALIDO', 'nfeProc deve conter um único protNFe.');
  }
  const infProtNodes = directNodes(protNodes[0], 'infProt');
  if (infProtNodes.length !== 1) {
    throw erroFiscal('PROTOCOLO_INVALIDO', 'protNFe deve conter um único infProt.');
  }
  const cStat = textValue(infProtNodes[0], 'cStat', 'PROTOCOLO_INVALIDO');
  if (cStat !== '100') {
    throw erroFiscal('PROTOCOLO_NAO_AUTORIZADO', `cStat ${cStat} não autoriza a exportação contábil.`);
  }
  const digVal = textValue(infProtNodes[0], 'digVal', 'DIGVAL_AUSENTE');
  const returnedDigest = digestBytes(digVal, 'DIGVAL_INVALIDO', 'digVal');
  if (!expectedDigest.equals(returnedDigest)) {
    throw erroFiscal('DIGEST_DIVERGENTE', 'digVal do protocolo não corresponde ao DigestValue da assinatura.');
  }
}

function referenciaNota(nota) {
  return String(
    nota.chave_acesso
    || (nota.numero ? `NFC-e ${nota.numero} série ${nota.serie || 1}` : `nota_${nota.id || 'desconhecida'}`)
  );
}

function extrairXmlNfceAutorizado(nota) {
  if (!nota) throw erroFiscal('NOTA_NAO_ENCONTRADA', 'NFC-e não encontrada.');
  const status = String(nota.status || '').trim().toLowerCase();
  if (!['autorizada', 'autorizado'].includes(status)) {
    throw erroFiscal('STATUS_NAO_AUTORIZADO', 'Documento não está marcado como autorizado.');
  }

  const xmlEnviado = nota.xml_enviado || nota.xml_assinado || null;
  if (!xmlEnviado) {
    throw erroFiscal('XML_TRANSMITIDO_AUSENTE', 'XML assinado transmitido não está disponível.');
  }
  const protocolo = String(nota.protocolo || '').trim();
  if (!/^\d{15}$/.test(protocolo)) {
    throw erroFiscal('PROTOCOLO_PERSISTIDO_INVALIDO', 'Protocolo persistido ausente ou inválido.');
  }

  const autorizado = obterXmlAutorizadoNota({
    ...nota,
    xml_enviado: xmlEnviado,
    protocolo
  });
  validarDigValXmlAssinado(xmlEnviado, autorizado.xml);
  return autorizado.xml;
}

function prepararNfceAutorizadasParaExportacao(notas) {
  const validas = [];
  const invalidas = [];
  for (const nota of Array.isArray(notas) ? notas : []) {
    try {
      validas.push({ nota, xml: extrairXmlNfceAutorizado(nota) });
    } catch (err) {
      invalidas.push({
        nota,
        referencia: referenciaNota(nota || {}),
        codigo: err.code || 'XML_AUTORIZADO_INVALIDO',
        motivo: err.message || 'Falha ao validar XML autorizado.'
      });
    }
  }
  return { validas, invalidas };
}

module.exports = {
  extrairXmlNfceAutorizado,
  prepararNfceAutorizadasParaExportacao,
  validarDigValXmlAssinado
};
