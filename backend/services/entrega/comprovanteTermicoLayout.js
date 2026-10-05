/**
 * Cupom térmico 58/80mm para entrega e prestação.
 * O bloco fica à esquerda, na área útil, e o valor permanece inteiro no fim da linha.
 */

'use strict';

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
  const cols = colunas(papelMm);
  const corpo = (linhas || []).map((linha) => escapeHtml(linha)).join('\n');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(titulo || 'Comprovante')}</title>
  <style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    pre.comprovante-termico {
      font-family: Consolas, "Courier New", monospace;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      color: #000;
      background: #fff;
      width: ${cols}ch;
      max-width: ${cols}ch;
      margin: 0;
      padding: 1.5mm 0.5mm 2mm;
      white-space: pre;
      letter-spacing: 0;
      overflow: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body class="${escapeHtml(classe || 'comprovante-termico')}">
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
