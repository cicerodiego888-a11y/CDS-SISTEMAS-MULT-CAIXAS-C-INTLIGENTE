/**
 * Layout monospace legado (entrega/prestação).
 * Sem consumidores em produção — mantido só para não reativar com 48ch.
 * Fluxos ativos usam geometriaCupom80 (HTML flex, util 72/48 mm).
 */

'use strict';

const { papelMmDe, larguraUtilMm, GT710_80 } = require('../termico/geometriaCupom80');

function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function colunas(papelMm) {
  return Number(papelMm) === 58 ? 32 : 48;
}

function quebrar(texto, largura) {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return [''];
  if (bruto.length <= largura) return [bruto];
  const linhas = [];
  let atual = '';
  for (const palavra of bruto.split(/\s+/)) {
    if (palavra.length > largura) {
      if (atual) linhas.push(atual);
      for (let i = 0; i < palavra.length; i += largura) {
        linhas.push(palavra.slice(i, i + largura));
      }
      atual = '';
      continue;
    }
    const candidato = atual ? `${atual} ${palavra}` : palavra;
    if (candidato.length <= largura) atual = candidato;
    else {
      if (atual) linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

function centro(texto, cols) {
  const s = String(texto ?? '');
  if (s.length >= cols) return s.slice(0, cols);
  return ' '.repeat(Math.floor((cols - s.length) / 2)) + s;
}

function blocoCentro(texto, cols) {
  return quebrar(texto, cols).map((parte) => centro(parte, cols));
}

function comporLinha(label, valor, cols) {
  const right = String(valor ?? '');
  const left = String(label ?? '');
  if (right.length >= cols) {
    return [...(left ? quebrar(left, cols) : []), ...quebrar(right, cols)];
  }
  const gap = cols - left.length - right.length;
  if (gap >= 1) return [left + ' '.repeat(gap) + right];
  const maxLeft = Math.max(0, cols - right.length - 1);
  const leftCut = left.slice(0, maxLeft);
  const espacos = Math.max(1, cols - leftCut.length - right.length);
  return [leftCut + ' '.repeat(espacos) + right];
}

function linhaSe(label, valor, cols) {
  const v = String(valor ?? '').trim();
  if (!v) return [];
  return comporLinha(`${label}:`, v, cols);
}

function documento({ titulo, classe, linhas, papelMm }) {
  const papel = papelMmDe(papelMm);
  const util = larguraUtilMm(papel);
  const cols = colunas(papel);
  const corpo = (linhas || []).map((linha) => escapeHtml(linha)).join('\n');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="cds-papel-mm" content="${papel}" />
  <meta name="cds-util-mm" content="${util}" />
  <meta name="cds-termico-ref" content="${papel === 80 ? GT710_80.modelo : 'TERMICO-58'}" />
  <title>${escapeHtml(titulo || 'Comprovante')}</title>
  <style>
    @page { size: ${papel}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${util}mm; max-width: ${util}mm; background: #fff; color: #000; }
    pre.comprovante-termico {
      font-family: Consolas, "Courier New", monospace;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      color: #000;
      background: #fff;
      width: ${util}mm;
      max-width: ${util}mm;
      margin: 0;
      padding: ${papel === 58 ? '1mm 2.5mm 1.6mm 1.5mm' : '1.2mm 3.5mm 2mm 2mm'};
      box-sizing: border-box;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      letter-spacing: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body class="${escapeHtml(classe || 'comprovante-termico')}" data-cds-papel-mm="${papel}" data-cds-util-mm="${util}" data-cds-cols="${cols}">
<pre class="comprovante-termico">${corpo}</pre>
</body>
</html>`;
}

module.exports = {
  colunas,
  quebrar,
  centro,
  blocoCentro,
  comporLinha,
  linhaSe,
  documento,
  escapeHtml
};
