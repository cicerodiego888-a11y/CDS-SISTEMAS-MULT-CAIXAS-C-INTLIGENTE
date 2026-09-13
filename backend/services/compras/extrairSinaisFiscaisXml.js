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
 * CSOSN (Simples) ou CST ICMS (regime normal) — primeiro item.
 */
function extrairCsosnOuCst(xml) {
  const csosn = primeiroMatch(xml, /<CSOSN[^>]*>(\d{3})<\/CSOSN>/i);
  if (csosn) return { tipo: 'CSOSN', valor: csosn };

  // CST dentro de bloco ICMS (evitar confundir com PIS/COFINS/IPI)
  const blocoIcms = primeiroMatch(xml, /<(ICMS\d+|ICMSSN\d+)[^>]*>[\s\S]*?<\/\1>/i)
    || String(xml || '').match(/<ICMS>[\s\S]*?<\/ICMS>/i)?.[0]
    || '';
  const cst = primeiroMatch(blocoIcms || xml, /<CST[^>]*>(\d{2})<\/CST>/i);
  if (cst) return { tipo: 'CST', valor: cst };
  return { tipo: null, valor: '' };
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
  extrairCsosnOuCst,
  extrairCstPis,
  extrairCstCofins,
  extrairCstIpi
};
