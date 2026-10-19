'use strict';

const RETORNO_PI = 'cdsNfceRetorno';

function removerDeclaracao(xml) {
  return String(xml || '').replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/i, '').trim();
}

function decodificarCdata(texto) {
  return String(texto || '')
    .split(']]]]><![CDATA[>').join(']]>')
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1');
}

function corpoTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : '';
}

function desempacotar(xml) {
  const texto = String(xml || '');
  const wrapper = texto.match(/^\s*<retornosNfce>([\s\S]*)<\/retornosNfce>\s*$/i);
  if (wrapper) {
    const anterior = decodificarCdata(corpoTag(wrapper[1], 'retornoAnterior'));
    const retornoAnterior = desempacotar(anterior);
    const atual = removerDeclaracao(decodificarCdata(corpoTag(wrapper[1], 'retornoAtual')));
    return {
      xmlOriginal: retornoAnterior.xmlOriginal,
      retornos: atual ? [...retornoAnterior.retornos, atual] : retornoAnterior.retornos
    };
  }

  const retornos = [];
  const piRegex = new RegExp(`<\\?${RETORNO_PI}\\s+([\\s\\S]*?)\\?>`, 'g');
  let match;
  while ((match = piRegex.exec(texto))) {
    retornos.push(match[1]);
  }

  return {
    xmlOriginal: texto.replace(piRegex, ''),
    retornos
  };
}

function adicionarRetornosComoPi(xmlOriginal, retornos) {
  const instrucoes = retornos.map((retorno) => {
    if (retorno.includes('?>')) {
      throw new Error('Retorno NFC-e contém terminador de instrução XML inválido.');
    }
    return `<?${RETORNO_PI} ${retorno}?>`;
  }).join('');
  // Processing instructions after the document element preserve the SEFAZ root and its parsed tree.
  return `${xmlOriginal}${instrucoes}`;
}

function appendXmlRetornoNfce(xmlAnterior, xmlAtual) {
  const anterior = desempacotar(xmlAnterior);
  const atual = removerDeclaracao(xmlAtual);
  if (!atual) {
    return String(xmlAnterior || '');
  }

  if (!anterior.xmlOriginal.trim()) {
    return atual;
  }

  return adicionarRetornosComoPi(anterior.xmlOriginal, [...anterior.retornos, atual]);
}

module.exports = { appendXmlRetornoNfce };
