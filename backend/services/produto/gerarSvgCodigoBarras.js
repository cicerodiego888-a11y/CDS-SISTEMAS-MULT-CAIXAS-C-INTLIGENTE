'use strict';

const bwipjs = require('bwip-js');

function escaparAtributoSvg(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function gerarSvgCodigoBarras(codigoBarras) {
  const codigo = String(codigoBarras ?? '').trim();
  if (!codigo) {
    throw new Error('Este produto não possui código de barras cadastrado.');
  }
  if (/[\u0000-\u001f\u007f]/.test(codigo)) {
    throw new Error('Código de barras contém caracteres inválidos.');
  }

  const svg = bwipjs.toSVG({
    bcid: 'code128',
    text: codigo,
    scale: 2,
    height: 14,
    includetext: true,
    textxalign: 'center',
    backgroundcolor: 'FFFFFF'
  });

  return svg.replace('<svg ', `<svg role="img" aria-label="Código de barras ${escaparAtributoSvg(codigo)}" `);
}

module.exports = { gerarSvgCodigoBarras };