'use strict';

const xml2js = require('xml2js');

const VERSAO_NFE = '4.00';
const NFE_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';

function erroFiscal(code, message) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = 409;
  return err;
}

function parseXml(xml, code) {
  const source = String(xml || '').replace(/^\uFEFF/, '').trim();
  if (!source || /<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw erroFiscal(code, 'XML ausente ou contém declaração não permitida.');
  }

  let parsed = null;
  let parseError = null;
  new xml2js.Parser({
    strict: true,
    explicitArray: true,
    trim: true,
    normalize: false,
    attrkey: '$',
    charkey: '_'
  }).parseString(source, (err, result) => {
    parseError = err || null;
    parsed = result || null;
  });

  if (parseError || !parsed) {
    throw erroFiscal(code, 'XML malformado.');
  }
  return parsed;
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
    if (localName(key) === String(name).toLowerCase()) {
      found.push(...asNodes(value));
    }
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

function textValue(parent, name, code) {
  const nodes = directNodes(parent, name);
  if (nodes.length !== 1) {
    throw erroFiscal(code, `Campo ${name} ausente ou duplicado.`);
  }
  const node = nodes[0];
  const value = node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, '_')
    ? node._
    : node;
  const text = String(value == null ? '' : value).trim();
  if (!text) throw erroFiscal(code, `Campo ${name} vazio.`);
  return text;
}

function attribute(node, name) {
  return String((node && node.$ && node.$[name]) || '').trim();
}

function extractXmlBlocks(xml, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<((?:[\\w.-]+:)?${escaped})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    'gi'
  );
  return [...String(xml || '').matchAll(pattern)].map((match) => match[0]);
}

function normalizarChave(value) {
  return String(value || '').replace(/\D/g, '');
}

function exigirChavePersistida(value) {
  const key = normalizarChave(value);
  if (!/^\d{44}$/.test(key)) {
    throw erroFiscal('CHAVE_INVALIDA', 'Chave persistida inválida; esperado 44 dígitos.');
  }
  return key;
}

function chaveDoNfeNode(nfeNode) {
  const infNfe = directNodes(nfeNode, 'infNFe');
  if (infNfe.length !== 1) {
    throw erroFiscal('XML_NFE_INVALIDO', 'XML deve conter um único elemento infNFe.');
  }
  const id = attribute(infNfe[0], 'Id');
  const match = id.match(/^NFe(\d{44})$/i);
  if (!match) {
    throw erroFiscal('CHAVE_INVALIDA', 'A identidade Id da NF-e é inválida.');
  }
  const version = attribute(infNfe[0], 'versao');
  if (version !== VERSAO_NFE) {
    throw erroFiscal('VERSAO_XML_INVALIDA', `Versão de infNFe inválida: ${version || 'ausente'}.`);
  }
  return { chaveAcesso: match[1], infNfe: infNfe[0], versao: version };
}

function parseNfe(xml, expectedKey) {
  const parsed = parseXml(xml, 'XML_NFE_MALFORMADO');
  const nfeNodes = findNodes(parsed, 'NFe');
  const fragments = extractXmlBlocks(xml, 'NFe');
  if (nfeNodes.length !== 1 || fragments.length !== 1) {
    throw erroFiscal('XML_NFE_INVALIDO', 'XML transmitido deve conter uma única NF-e.');
  }

  const identity = chaveDoNfeNode(nfeNodes[0]);
  if (identity.chaveAcesso !== expectedKey) {
    throw erroFiscal('CHAVE_DIVERGENTE', 'A chave do XML transmitido não corresponde à chave persistida.');
  }

  return {
    chaveAcesso: identity.chaveAcesso,
    versao: identity.versao,
    xml: fragments[0]
  };
}

function validarProtocoloNode(protNode, expectedKey) {
  const version = attribute(protNode, 'versao');
  if (version !== VERSAO_NFE) {
    throw erroFiscal('VERSAO_PROTOCOLO_INVALIDA', `Versão de protNFe inválida: ${version || 'ausente'}.`);
  }

  const infProt = directNodes(protNode, 'infProt');
  if (infProt.length !== 1) {
    throw erroFiscal('PROTOCOLO_INVALIDO', 'protNFe deve conter um único infProt.');
  }

  const chaveAcesso = textValue(infProt[0], 'chNFe', 'PROTOCOLO_INVALIDO');
  if (!/^\d{44}$/.test(chaveAcesso) || chaveAcesso !== expectedKey) {
    throw erroFiscal('CHAVE_PROTOCOLO_DIVERGENTE', 'A chave do protocolo não corresponde à NF-e transmitida.');
  }

  const cStat = textValue(infProt[0], 'cStat', 'PROTOCOLO_INVALIDO');
  if (!['100', '150'].includes(cStat)) {
    throw erroFiscal('PROTOCOLO_NAO_AUTORIZADO', `cStat ${cStat} não autoriza o documento.`);
  }

  const xMotivo = textValue(infProt[0], 'xMotivo', 'PROTOCOLO_INVALIDO');
  const protocolo = textValue(infProt[0], 'nProt', 'PROTOCOLO_INVALIDO');
  if (!/^\d{15}$/.test(protocolo)) {
    throw erroFiscal('PROTOCOLO_INVALIDO', 'nProt deve conter 15 dígitos.');
  }

  return { chaveAcesso, cStat, xMotivo, protocolo, versao: version };
}

function namespaceDeclarations(sources) {
  const declarations = new Map();
  const pattern = /\sxmlns:([\w.-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const source of sources) {
    let match;
    while ((match = pattern.exec(String(source || '')))) {
      const current = declarations.get(match[1]);
      if (current && current !== match[3]) {
        throw erroFiscal('NAMESPACE_XML_AMBIGUO', `Namespace ${match[1]} ambíguo no XML.`);
      }
      declarations.set(match[1], match[3]);
    }
  }
  return declarations;
}

function namespacesForFragments(fragments, sources) {
  const used = new Set();
  const declaredInFragments = new Set();
  for (const fragment of fragments) {
    for (const match of fragment.matchAll(/<\/?([\w.-]+):[\w.-]+/g)) used.add(match[1]);
    for (const match of fragment.matchAll(/\sxmlns:([\w.-]+)\s*=/g)) declaredInFragments.add(match[1]);
  }

  const declarations = namespaceDeclarations(sources);
  const attrs = [];
  for (const prefix of used) {
    if (prefix === 'xml' || declaredInFragments.has(prefix)) continue;
    const uri = declarations.get(prefix);
    if (!uri) {
      throw erroFiscal('NAMESPACE_XML_INVALIDO', `Namespace ${prefix} não declarado.`);
    }
    attrs.push(` xmlns:${prefix}="${uri}"`);
  }
  return attrs.join('');
}

function montarEnvelopeNfeProc(nfeXml, protXml, sources) {
  const namespaceAttrs = namespacesForFragments([nfeXml, protXml], sources);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<nfeProc xmlns="${NFE_NAMESPACE}" versao="${VERSAO_NFE}"${namespaceAttrs}>`
    + `${nfeXml}${protXml}</nfeProc>`;
  parseXml(xml, 'NFE_PROC_MALFORMADO');
  return xml;
}

function validarXmlProcessado(xml, {
  xmlEnviado,
  chaveAcesso,
  protocoloPersistido
} = {}) {
  const expectedKey = exigirChavePersistida(chaveAcesso);
  const parsed = parseXml(xml, 'NFE_PROC_MALFORMADO');
  const procNodes = findNodes(parsed, 'nfeProc');
  const procFragments = extractXmlBlocks(xml, 'nfeProc');
  if (procNodes.length !== 1 || procFragments.length !== 1) {
    throw erroFiscal('NFE_PROC_INVALIDO', 'XML autorizado deve conter um único nfeProc.');
  }

  const procNode = procNodes[0];
  const version = attribute(procNode, 'versao');
  if (version !== VERSAO_NFE) {
    throw erroFiscal('VERSAO_NFE_PROC_INVALIDA', `Versão de nfeProc inválida: ${version || 'ausente'}.`);
  }

  const nfeNodes = directNodes(procNode, 'NFe');
  const protNodes = directNodes(procNode, 'protNFe');
  const nfeFragments = extractXmlBlocks(procFragments[0], 'NFe');
  const protFragments = extractXmlBlocks(procFragments[0], 'protNFe');
  if (nfeNodes.length !== 1 || protNodes.length !== 1
      || nfeFragments.length !== 1 || protFragments.length !== 1) {
    throw erroFiscal('NFE_PROC_INVALIDO', 'nfeProc deve conter exatamente uma NF-e e um protNFe.');
  }

  const nfeIdentity = chaveDoNfeNode(nfeNodes[0]);
  if (nfeIdentity.chaveAcesso !== expectedKey) {
    throw erroFiscal('CHAVE_DIVERGENTE', 'A chave do nfeProc não corresponde à chave persistida.');
  }
  const protocol = validarProtocoloNode(protNodes[0], expectedKey);

  let nfeAutorizadaXml = nfeFragments[0];
  if (xmlEnviado) {
    const transmitted = parseNfe(xmlEnviado, expectedKey);
    if (transmitted.chaveAcesso !== nfeIdentity.chaveAcesso) {
      throw erroFiscal('CHAVE_DIVERGENTE', 'A NF-e processada não corresponde ao XML transmitido.');
    }
    nfeAutorizadaXml = transmitted.xml;
  }

  if (protocoloPersistido && String(protocoloPersistido).trim() !== protocol.protocolo) {
    throw erroFiscal('PROTOCOLO_DIVERGENTE', 'nProt não corresponde ao protocolo persistido.');
  }

  return {
    xml: montarEnvelopeNfeProc(nfeAutorizadaXml, protFragments[0], [xml, procFragments[0]]),
    ...protocol
  };
}

function montarXmlAutorizado({
  xmlEnviado,
  xmlRetorno,
  chaveAcesso,
  protocoloPersistido
} = {}) {
  const expectedKey = exigirChavePersistida(chaveAcesso);
  if (!xmlEnviado) {
    throw erroFiscal('XML_TRANSMITIDO_AUSENTE', 'XML assinado transmitido não está disponível.');
  }
  const transmitted = parseNfe(xmlEnviado, expectedKey);
  const retorno = String(xmlRetorno || '');
  const parsedRetorno = parseXml(retorno, 'XML_RETORNO_MALFORMADO');

  const procNodes = findNodes(parsedRetorno, 'nfeProc');
  const procFragments = extractXmlBlocks(retorno, 'nfeProc');
  const procValidos = [];
  let erroRelacionado = null;

  for (let i = 0; i < Math.min(procNodes.length, procFragments.length); i += 1) {
    const procNode = procNodes[i];
    const procNfes = directNodes(procNode, 'NFe');
    const procProtocols = directNodes(procNode, 'protNFe');
    let chaveNfe = null;
    let chaveProt = null;
    try {
      if (procNfes.length === 1) chaveNfe = chaveDoNfeNode(procNfes[0]).chaveAcesso;
      if (procProtocols.length === 1) {
        const infos = directNodes(procProtocols[0], 'infProt');
        if (infos.length === 1) {
          chaveProt = normalizarChave(textValue(infos[0], 'chNFe', 'PROTOCOLO_INVALIDO'));
        }
      }
      if (chaveNfe !== expectedKey && chaveProt !== expectedKey) continue;
      procValidos.push(validarXmlProcessado(procFragments[i], {
        xmlEnviado: transmitted.xml,
        chaveAcesso: expectedKey,
        protocoloPersistido
      }));
    } catch (err) {
      if (chaveNfe === expectedKey || chaveProt === expectedKey) erroRelacionado = err;
    }
  }

  if (procValidos.length > 1) {
    throw erroFiscal('NFE_PROC_AMBIGUO', 'Retorno contém mais de um nfeProc para a chave transmitida.');
  }
  if (procValidos.length === 1) return procValidos[0];
  if (erroRelacionado) throw erroRelacionado;
  if (procNodes.length || procFragments.length) {
    throw erroFiscal('NFE_PROC_DIVERGENTE', 'nfeProc do retorno não corresponde à chave transmitida.');
  }

  const protNodes = findNodes(parsedRetorno, 'protNFe');
  const protFragments = extractXmlBlocks(retorno, 'protNFe');
  const protocolosValidos = [];
  let protocoloOutraChave = false;
  for (let i = 0; i < Math.min(protNodes.length, protFragments.length); i += 1) {
    const protNode = protNodes[i];
    const infos = directNodes(protNode, 'infProt');
    let chaveProt = null;
    try {
      if (infos.length === 1) {
        chaveProt = normalizarChave(textValue(infos[0], 'chNFe', 'PROTOCOLO_INVALIDO'));
      }
      if (chaveProt !== expectedKey) {
        if (/^\d{44}$/.test(chaveProt)) protocoloOutraChave = true;
        continue;
      }
      const protocol = validarProtocoloNode(protNode, expectedKey);
      if (protocoloPersistido && String(protocoloPersistido).trim() !== protocol.protocolo) {
        throw erroFiscal('PROTOCOLO_DIVERGENTE', 'nProt não corresponde ao protocolo persistido.');
      }
      const xml = montarEnvelopeNfeProc(transmitted.xml, protFragments[i], [xmlEnviado, retorno]);
      const result = validarXmlProcessado(xml, {
        xmlEnviado: transmitted.xml,
        chaveAcesso: expectedKey,
        protocoloPersistido
      });
      protocolosValidos.push(result);
    } catch (err) {
      if (chaveProt === expectedKey) erroRelacionado = err;
    }
  }

  if (protocolosValidos.length > 1) {
    throw erroFiscal('PROTOCOLO_AMBIGUO', 'Retorno contém mais de um protocolo para a chave transmitida.');
  }
  if (protocolosValidos.length === 1) return protocolosValidos[0];
  if (erroRelacionado) throw erroRelacionado;
  if (protocoloOutraChave) {
    throw erroFiscal('CHAVE_PROTOCOLO_DIVERGENTE', 'O protocolo retornado pertence a outra chave de acesso.');
  }
  throw erroFiscal('PROTOCOLO_AUSENTE', 'Retorno não contém protNFe válido para a chave transmitida.');
}

function obterXmlAutorizadoNota(nota) {
  if (!nota) throw erroFiscal('NOTA_NAO_ENCONTRADA', 'NFC-e não encontrada.');
  const xmlEnviado = nota.xml_enviado || nota.xml_assinado || null;
  const chaveAcesso = nota.chave_acesso;
  const protocoloPersistido = nota.protocolo || null;
  let erroArmazenado = null;

  if (nota.xml_autorizado) {
    try {
      return validarXmlProcessado(nota.xml_autorizado, {
        xmlEnviado,
        chaveAcesso,
        protocoloPersistido
      });
    } catch (err) {
      erroArmazenado = err;
    }
  }

  if (nota.xml_retorno) {
    try {
      if (xmlEnviado) {
        return montarXmlAutorizado({
          xmlEnviado,
          xmlRetorno: nota.xml_retorno,
          chaveAcesso,
          protocoloPersistido
        });
      }
      return validarXmlProcessado(nota.xml_retorno, {
        chaveAcesso,
        protocoloPersistido
      });
    } catch (err) {
      if (!erroArmazenado) erroArmazenado = err;
    }
  }

  if (erroArmazenado) throw erroArmazenado;
  throw erroFiscal('XML_AUTORIZADO_NAO_DISPONIVEL', 'XML processado válido não está disponível.');
}

module.exports = {
  montarXmlAutorizado,
  validarXmlProcessado,
  obterXmlAutorizadoNota
};
