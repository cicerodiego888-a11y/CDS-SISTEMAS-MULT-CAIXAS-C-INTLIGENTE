/**
 * Hash e comparação de XML fiscal (identidade de conteúdo).
 */

'use strict';

const crypto = require('crypto');
const { compactarXml, onlyDigits } = require('./utils');

function calcularHashXml(xml) {
  const normalizado = compactarXml(xml);
  return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

function compararXmlFiscal(xmlA, xmlB) {
  const hashA = calcularHashXml(xmlA);
  const hashB = calcularHashXml(xmlB);
  return {
    iguais: hashA === hashB,
    hashA,
    hashB
  };
}

function extrairChaveDoXml(xml) {
  const id = String(xml || '').match(/Id="NFe(\d{44})"/i);
  if (id) return id[1];
  const ch = String(xml || '').match(/<chNFe>(\d{44})<\/chNFe>/i);
  return ch ? ch[1] : null;
}

function validarChaveContraXml(chave, xml) {
  const esperada = onlyDigits(chave);
  const noXml = extrairChaveDoXml(xml);
  if (esperada.length !== 44) {
    const err = new Error('Chave de acesso inválida (exige 44 dígitos).');
    err.code = 'CHAVE_INVALIDA';
    throw err;
  }
  if (noXml && noXml !== esperada) {
    const err = new Error(
      'Conflito fiscal: a chave persistida não corresponde à chave do XML.'
    );
    err.code = 'CHAVE_XML_DIVERGENTE';
    err.detalhes = { chave: esperada, chaveXml: noXml };
    throw err;
  }
  return true;
}

function validarMesmaChaveMesmoXml({ chave, xmlAtual, xmlReferencia, hashReferencia }) {
  const chaveAtual = onlyDigits(chave);
  const chaveXml = extrairChaveDoXml(xmlAtual);
  if (chaveXml && chaveAtual && chaveXml !== chaveAtual) {
    const err = new Error(
      'Conflito fiscal: esta chave de acesso já está associada a um documento com conteúdo diferente. Uma nova NF-e deve receber nova identidade fiscal.'
    );
    err.code = 'CHAVE_XML_CONFLITO';
    throw err;
  }
  if (!xmlReferencia && !hashReferencia) return { ok: true };
  const hashAtual = calcularHashXml(xmlAtual);
  const hashAntigo = hashReferencia || calcularHashXml(xmlReferencia);
  if (chaveAtual && hashAtual !== hashAntigo) {
    const err = new Error(
      'Conflito fiscal: esta chave de acesso já está associada a um documento com conteúdo diferente. Uma nova NF-e deve receber nova identidade fiscal.'
    );
    err.code = 'CHAVE_XML_CONFLITO';
    err.detalhes = { chave: chaveAtual, xmlHashAtual: hashAtual, xmlHashAnterior: hashAntigo };
    throw err;
  }
  return { ok: true, hash: hashAtual };
}

module.exports = {
  calcularHashXml,
  compararXmlFiscal,
  extrairChaveDoXml,
  validarChaveContraXml,
  validarMesmaChaveMesmoXml
};
