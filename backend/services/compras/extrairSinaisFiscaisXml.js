/**
 * Extração leve de dados fiscais do XML (somente leitura).
 * XML SEFAZ permanece imutável — valores servem à escrituração interna.
 */

'use strict';

function textoTag(xml, tag) {
  if (!xml || !tag) return '';
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const m = String(xml).match(re);
  return m ? String(m[1] || '').trim() : '';
}

function primeiroMatch(xml, re) {
  const m = String(xml || '').match(re);
  return m ? String(m[1] || '').trim() : '';
}

function todosCfops(xml) {
  const src = String(xml || '');
  const re = /<CFOP[^>]*>(\d{4})<\/CFOP>/gi;
  const lista = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    lista.push(m[1]);
  }
  return lista;
}

function cfopPredominanteDe(cfops) {
  const contagem = {};
  (cfops || []).forEach((c) => {
    contagem[c] = (contagem[c] || 0) + 1;
  });
  let pred = null;
  let max = 0;
  Object.keys(contagem).forEach((c) => {
    if (contagem[c] > max) {
      max = contagem[c];
      pred = c;
    }
  });
  return pred;
}

/**
 * Código tributário do grupo ICMS (filho único de <ICMS>: ICMS00…ICMS90, ICMSPart, ICMSST, ICMSSN101…ICMSSN900).
 * O valor vem do campo CST (2 dígitos) ou CSOSN (3 dígitos) dentro do grupo, nunca do nome da tag.
 * Grupo com ambos os campos é ambíguo e não gera código.
 */
function codigoTributarioDoBlocoIcms(blocoIcms) {
  const grupo = String(blocoIcms || '').match(/<(ICMS[A-Za-z0-9]+)\b[^>]*>([\s\S]*?)<\/\1>/);
  if (!grupo) return { grupo: null, tipo: null, valor: '' };
  const cst = primeiroMatch(grupo[2], /<CST[^>]*>\s*(\d{2})\s*<\/CST>/);
  const csosn = primeiroMatch(grupo[2], /<CSOSN[^>]*>\s*(\d{3})\s*<\/CSOSN>/);
  if (cst && csosn) return { grupo: grupo[1], tipo: null, valor: '' };
  if (csosn) return { grupo: grupo[1], tipo: 'CSOSN', valor: csosn };
  if (cst) return { grupo: grupo[1], tipo: 'CST', valor: cst };
  return { grupo: grupo[1], tipo: null, valor: '' };
}

function blocoIcmsDe(trecho) {
  return String(trecho || '').match(/<ICMS>([\s\S]*?)<\/ICMS>/)?.[1] || '';
}

/**
 * CSOSN/CST de cada item (<det>), na ordem do XML.
 * @returns {Array<{ nItem: string|null, grupo: string|null, tipo: 'CST'|'CSOSN'|null, valor: string }>}
 */
function extrairCsosnOuCstItens(xml) {
  const itens = [];
  const re = /<det\b([^>]*)>([\s\S]*?)<\/det>/gi;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    const nItem = m[1].match(/nItem="(\d+)"/)?.[1] || null;
    itens.push({ nItem, ...codigoTributarioDoBlocoIcms(blocoIcmsDe(m[2])) });
  }
  return itens;
}

/**
 * CSOSN (Simples) ou CST ICMS (regime normal) do documento — primeiro item que informa o código.
 */
function extrairCsosnOuCst(xml) {
  const itens = extrairCsosnOuCstItens(xml);
  const candidatos = itens.length ? itens : [codigoTributarioDoBlocoIcms(blocoIcmsDe(xml))];
  const encontrado = candidatos.find((i) => i.tipo);
  return encontrado ? { tipo: encontrado.tipo, valor: encontrado.valor } : { tipo: null, valor: '' };
}

function extrairCstPis(xml) {
  const bloco = String(xml || '').match(/<PIS>[\s\S]*?<\/PIS>/i)?.[0] || '';
  return primeiroMatch(bloco, /<CST[^>]*>(\d{2})<\/CST>/i);
}

function extrairCstCofins(xml) {
  const bloco = String(xml || '').match(/<COFINS>[\s\S]*?<\/COFINS>/i)?.[0] || '';
  return primeiroMatch(bloco, /<CST[^>]*>(\d{2})<\/CST>/i);
}

function extrairCstIpi(xml) {
  const bloco = String(xml || '').match(/<IPI>[\s\S]*?<\/IPI>/i)?.[0] || '';
  if (!bloco) return '';
  return primeiroMatch(bloco, /<CST[^>]*>(\d{2})<\/CST>/i);
}

/**
 * Documentos referenciados em <NFref> (somente os que constam no XML).
 * @returns {{ chavesNFe: string[], outras: number }}
 */
function extrairReferenciasDocumentos(xml) {
  const blocos = String(xml || '').match(/<NFref>[\s\S]*?<\/NFref>/gi) || [];
  const chavesNFe = [];
  let outras = 0;
  blocos.forEach((bloco) => {
    const chave = primeiroMatch(bloco, /<refNFe[^>]*>(\d{44})<\/refNFe>/i);
    if (chave) chavesNFe.push(chave);
    else outras += 1;
  });
  return { chavesNFe, outras };
}

/**
 * @param {string} xml
 * @returns {Object}
 */
function extrairSinaisFiscaisDoXml(xml) {
  const cfops = todosCfops(xml);
  const csosnCst = extrairCsosnOuCst(xml);
  return {
    cfops,
    cfopPredominante: cfopPredominanteDe(cfops),
    natureza: textoTag(xml, 'natOp') || '',
    finalidade: textoTag(xml, 'finNFe') || null,
    tipoOperacao: textoTag(xml, 'tpNF') || null,
    referencias: extrairReferenciasDocumentos(xml),
    csosn: csosnCst.tipo === 'CSOSN' ? csosnCst.valor : '',
    cstIcms: csosnCst.tipo === 'CST' ? csosnCst.valor : '',
    csosnOuCst: csosnCst.valor || '',
    csosnOuCstTipo: csosnCst.tipo,
    cstPis: extrairCstPis(xml),
    cstCofins: extrairCstCofins(xml),
    cstIpi: extrairCstIpi(xml)
  };
}

/**
 * Alias completo para validação fiscal / escrituração.
 */
function extrairDadosFiscaisXml(xml) {
  return extrairSinaisFiscaisDoXml(xml);
}

module.exports = {
  extrairSinaisFiscaisDoXml,
  extrairDadosFiscaisXml,
  textoTag,
  todosCfops,
  extrairReferenciasDocumentos,
  extrairCsosnOuCst,
  extrairCsosnOuCstItens,
  extrairCstPis,
  extrairCstCofins,
  extrairCstIpi
};
