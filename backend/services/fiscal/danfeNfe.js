/**
 * DANFE NF-e (modelo 55) — representação visual A4 retrato.
 * Separado do DANFE NFC-e (danfe.js). Não altera XML nem identidade fiscal.
 */

'use strict';

const { montarModeloDanfe } = require('./danfeModelo');
const { renderizarDanfeHtml } = require('./danfeLayout');
const { gerarPdfDanfeDoModelo } = require('./danfePdf');

async function gerarDanfeNfeHtml(opts = {}) {
  const modelo = montarModeloDanfe({
    xml: opts.xml || '',
    extras: opts
  });
  return renderizarDanfeHtml(modelo);
}

function gerarDanfeNfePdf(opts = {}) {
  const modelo = montarModeloDanfe({
    xml: opts.xml || '',
    extras: opts
  });
  return gerarPdfDanfeDoModelo(modelo);
}

module.exports = {
  gerarDanfeNfeHtml,
  gerarDanfeNfePdf,
  montarModeloDanfe,
  renderizarDanfeHtml
};
