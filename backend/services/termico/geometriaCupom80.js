/**
 * Geometria compartilhada dos comprovantes térmicos 80/58 mm.
 * O papel é a referência. A janela do Electron não entra aqui.
 */
'use strict';

function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function papelMmDe(valor) {
  return Number(valor) === 58 ? 58 : 80;
}

function cssCupomTermico(papelMm) {
  const papel = papelMmDe(papelMm);
  const estreito = papel === 58;
  return `
    @page { size: ${papel}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    .cds-cupom-termico {
      width: ${papel}mm; max-width: ${papel}mm;
      margin: 0 auto;
      padding: ${estreito ? '1.2mm 2mm 1.6mm' : '1.5mm 2.5mm 2mm'};
      box-sizing: border-box;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: ${estreito ? '9px' : '11px'};
      line-height: 1.22;
      font-weight: 600;
      color: #000; background: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .cds-cupom-termico * { box-sizing: border-box; }
    .empresa {
      font-size: ${estreito ? '13px' : '18px'}; font-weight: 800;
      text-align: center; text-transform: uppercase; overflow-wrap: anywhere; line-height: 1.15;
    }
    .razao, .meta { text-align: center; overflow-wrap: anywhere; font-size: ${estreito ? '9px' : '11px'}; }
    .titulo { font-size: ${estreito ? '12px' : '16px'}; font-weight: 800; text-align: center; line-height: 1.15; }
    .sec { font-size: ${estreito ? '10px' : '12px'}; font-weight: 800; text-align: center; margin: 1.2mm 0 0.4mm; overflow-wrap: anywhere; }
    .txt, .aviso { text-align: center; overflow-wrap: anywhere; }
    .aviso { font-weight: 800; }
    .sep { border: 0; border-top: 1px solid #000; margin: 0.8mm 0; }
    .row, .item-linha {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 2mm; width: 100%; max-width: 100%;
    }
    .rotulo, .item-nome, .txt { min-width: 0; overflow-wrap: anywhere; }
    .valor {
      flex: 0 1 auto; max-width: 58%; text-align: right; font-weight: 700; overflow-wrap: anywhere;
    }
    .item { margin: 0 0 0.8mm; width: 100%; }
    .item-nome { font-weight: 700; }
    .total .rotulo, .total .valor { font-size: ${estreito ? '12px' : '16px'}; font-weight: 700; }
  `;
}

function linha(rotulo, valor, extra) {
  const classe = extra ? `row ${extra}` : 'row';
  return `<div class="${classe}"><span class="rotulo">${escapeHtml(rotulo)}</span><span class="valor">${escapeHtml(valor)}</span></div>`;
}

function centro(texto, classe) {
  return `<div class="${classe || 'sec'}">${escapeHtml(texto)}</div>`;
}

function texto(textoLinha, classe) {
  const v = String(textoLinha ?? '').trim();
  if (!v) return '';
  return `<div class="${classe || 'txt'}">${escapeHtml(v)}</div>`;
}

function sep() {
  return '<hr class="sep">';
}

function documento({ titulo, classe, corpo, papelMm }) {
  const papel = papelMmDe(papelMm);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(titulo || 'Comprovante')}</title>
  <style>${cssCupomTermico(papel)}</style>
</head>
<body class="${escapeHtml(classe || 'comprovante-termico')}">
<main class="cds-cupom-termico">${corpo || ''}</main>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  papelMmDe,
  cssCupomTermico,
  linha,
  centro,
  texto,
  sep,
  documento
};
