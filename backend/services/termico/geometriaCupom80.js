/**
 * Geometria compartilhada dos comprovantes térmicos 80/58 mm.
 *
 * GT710 (ESC/POS, bobina 80 mm): a cabeça queima 576 dots a 203 dpi ≈ 72 mm.
 * O CDS não manda ESC/POS neste cupom — HTML → Chromium/Electron → driver Windows.
 * O @page declara o rolo; o miolo nasce na faixa útil e fica à esquerda,
 * para o valor da direita não sair da área queimada.
 */
'use strict';

/** Referência de hardware usada na geometria 80 mm (Goldentec GT710). */
const GT710_80 = Object.freeze({
  modelo: 'GT710',
  papelMm: 80,
  utilMm: 72,
  dpi: 203,
  dots: 576,
  mecanismo: 'html-electron-driver'
});

/**
 * Recuo da coluna monetária dentro da área útil (não desloca o cupom no papel).
 * Padding do miolo: top right bottom left — direita maior que a esquerda.
 * padding-right em .valor mantém os números alinhados e longe da borda queimada.
 */
const COLUNA_VALOR_TERMICO = Object.freeze({
  paddingCupom80: '1.2mm 3.5mm 2mm 2mm',
  paddingCupom58: '1mm 2.5mm 1.6mm 1.5mm',
  valorPaddingRight80: '1.5mm',
  valorPaddingRight58: '1.2mm',
  valorMaxWidthPct: 50
});

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

function larguraUtilMm(papelMm) {
  return papelMmDe(papelMm) === 58 ? 48 : GT710_80.utilMm;
}

function paddingCupomTermico(papelMm) {
  return papelMmDe(papelMm) === 58
    ? COLUNA_VALOR_TERMICO.paddingCupom58
    : COLUNA_VALOR_TERMICO.paddingCupom80;
}

function paddingValorTermico(papelMm) {
  return papelMmDe(papelMm) === 58
    ? COLUNA_VALOR_TERMICO.valorPaddingRight58
    : COLUNA_VALOR_TERMICO.valorPaddingRight80;
}

/** CSS da coluna monetária — reutilizar em templates que não passam por documento(). */
function cssColunaValorTermico(papelMm, seletores) {
  const alvo = seletores || '.valor, .item-tot, .cds-valor-termico';
  const recuo = paddingValorTermico(papelMm);
  const maxPct = COLUNA_VALOR_TERMICO.valorMaxWidthPct;
  return `
    ${alvo} {
      flex: 0 1 auto; max-width: ${maxPct}%; min-width: 0;
      text-align: right; font-weight: 700; overflow-wrap: anywhere;
      padding-right: ${recuo}; box-sizing: border-box;
    }
  `;
}

function cssCupomTermico(papelMm) {
  const papel = papelMmDe(papelMm);
  const util = larguraUtilMm(papel);
  const estreito = papel === 58;
  return `
    @page { size: ${papel}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${util}mm; max-width: ${util}mm; background: #fff; color: #000; }
    .cds-cupom-termico {
      width: ${util}mm; max-width: ${util}mm;
      margin: 0;
      padding: ${paddingCupomTermico(papel)};
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
      gap: 1.5mm; width: 100%; max-width: 100%; min-width: 0;
    }
    .rotulo, .item-nome { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .txt { min-width: 0; overflow-wrap: anywhere; }
    ${cssColunaValorTermico(papel, '.valor')}
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
  const util = larguraUtilMm(papel);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="cds-papel-mm" content="${papel}" />
  <meta name="cds-util-mm" content="${util}" />
  <meta name="cds-termico-ref" content="${papel === 80 ? GT710_80.modelo : 'TERMICO-58'}" />
  <title>${escapeHtml(titulo || 'Comprovante')}</title>
  <style>${cssCupomTermico(papel)}</style>
</head>
<body class="${escapeHtml(classe || 'comprovante-termico')}" data-cds-papel-mm="${papel}" data-cds-util-mm="${util}">
<main class="cds-cupom-termico">${corpo || ''}</main>
</body>
</html>`;
}

module.exports = {
  GT710_80,
  COLUNA_VALOR_TERMICO,
  escapeHtml,
  papelMmDe,
  larguraUtilMm,
  paddingCupomTermico,
  paddingValorTermico,
  cssColunaValorTermico,
  cssCupomTermico,
  linha,
  centro,
  texto,
  sep,
  documento
};
