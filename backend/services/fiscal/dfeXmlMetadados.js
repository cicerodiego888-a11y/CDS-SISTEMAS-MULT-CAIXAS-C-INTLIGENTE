/**
 * dfeXmlMetadados — Extração de metadados básicos de XML NF-e / resNFe.
 * RC3.7.1 — fallback de nNF/série a partir da chave de acesso.
 *
 * @module services/fiscal/dfeXmlMetadados
 */

'use strict';

function extrairTag(xml, tag) {
  return String(xml || '').match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'))?.[1] || '';
}

function extrairChave(xml) {
  const chNFe = extrairTag(xml, 'chNFe');
  if (chNFe) return chNFe.replace(/\D/g, '');

  const idMatch = String(xml || '').match(/Id="NFe(\d{44})"/i);
  return idMatch?.[1] || '';
}

/**
 * Chave NF-e: cUF(2)+AAMM(4)+CNPJ(14)+mod(2)+serie(3)+nNF(9)+tpEmis(1)+cNF(8)+cDV(1)
 * @param {string} chave
 * @returns {{ serie: string, numero: string, modelo: string }}
 */
function extrairNumeroSerieDaChave(chave) {
  const digitos = String(chave || '').replace(/\D/g, '');
  if (digitos.length !== 44) return { serie: '', numero: '', modelo: '' };
  const modelo = digitos.slice(20, 22);
  const serieRaw = digitos.slice(22, 25);
  const nNfRaw = digitos.slice(25, 34);
  return {
    modelo,
    serie: String(Number(serieRaw) || serieRaw),
    numero: String(Number(nNfRaw) || nNfRaw)
  };
}

function formatarDataIso(dh) {
  if (!dh) return '';
  const match = String(dh).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function detectarNfCancelada(xml) {
  const texto = String(xml || '');
  if (/<tpEvento>110111<\/tpEvento>/i.test(texto)) return true;
  if (/<tpEvento>110112<\/tpEvento>/i.test(texto)) return true;

  const cStat = extrairTag(texto, 'cStat');
  if (cStat === '101') return true;

  const cSit = extrairTag(texto, 'cSitNFe');
  if (cSit === '3') return true;

  return false;
}

function extrairMetadadosNota(xml) {
  const chave = extrairChave(xml);
  const daChave = extrairNumeroSerieDaChave(chave);
  const emitBlock = String(xml || '').match(/<emit>([\s\S]*?)<\/emit>/i)?.[1] || '';

  let numero = extrairTag(xml, 'nNF');
  let serie = extrairTag(xml, 'serie');
  let modelo = extrairTag(xml, 'mod') || '';

  // resNFe / ausência de ide: deriva da chave
  if (!numero && daChave.numero) numero = daChave.numero;
  if (!serie && daChave.serie) serie = daChave.serie;
  if (!modelo && daChave.modelo) modelo = daChave.modelo;
  if (!modelo) modelo = '55';

  // Preferir série do ide quando houver vários <serie> — tenta bloco ide
  const ideBlock = String(xml || '').match(/<ide>([\s\S]*?)<\/ide>/i)?.[1] || '';
  if (ideBlock) {
    const serieIde = extrairTag(ideBlock, 'serie');
    const nNfIde = extrairTag(ideBlock, 'nNF');
    if (serieIde) serie = serieIde;
    if (nNfIde) numero = nNfIde;
  }

  return {
    chave,
    numero: numero ? String(Number(numero) || numero) : '',
    serie: serie ? String(Number(serie) || serie) : '',
    modelo,
    fornecedor: extrairTag(emitBlock, 'xNome') || extrairTag(xml, 'xNome'),
    cnpjFornecedor: extrairTag(emitBlock, 'CNPJ') || extrairTag(xml, 'CNPJ'),
    dataEmissao: formatarDataIso(extrairTag(xml, 'dhEmi')),
    dataEntrada: formatarDataIso(extrairTag(xml, 'dhSaiEnt')),
    valorTotal: parseFloat(extrairTag(xml, 'vNF') || 0),
    situacaoNfe: extrairTag(xml, 'cSitNFe') || ''
  };
}

module.exports = {
  extrairMetadadosNota,
  extrairChave,
  extrairNumeroSerieDaChave,
  detectarNfCancelada
};
