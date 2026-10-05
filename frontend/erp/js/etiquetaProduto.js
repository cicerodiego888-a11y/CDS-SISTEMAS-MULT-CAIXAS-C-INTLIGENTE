(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.EtiquetaProduto = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const ERROS = Object.freeze({
        NAO_SALVO: 'Salve o produto antes de imprimir a etiqueta.',
        NOME: 'Este produto não possui nome para impressão da etiqueta.',
        PRECO: 'Este produto não possui preço válido para impressão da etiqueta.',
        CODIGO_BARRAS: 'Este produto não possui código de barras cadastrado.'
    });

    function escaparHtml(valor) {
        return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function validarProduto(produto = {}) {
        if (!Number.isInteger(Number(produto.id)) || Number(produto.id) <= 0) return ERROS.NAO_SALVO;
        if (!String(produto.nome ?? '').trim()) return ERROS.NOME;
        const preco = Number(produto.preco_venda);
        if (!Number.isFinite(preco) || preco <= 0) return ERROS.PRECO;
        return null;
    }

    function formatarPreco(valor) {
        return `R$: ${Number(valor).toFixed(2).replace('.', ',')}`;
    }

    function calcularFonteNome(nome) {
        const caracteres = Array.from(String(nome || '').trim()).length;
        if (!caracteres) return 14;
        return Math.max(7, Math.min(14, (14 * 54) / caracteres));
    }

    /** Larguras em em do .preco (weight 800 → Arial Black no Windows); demais caracteres contam como dígito. */
    const LARGURA_EM_PRECO = Object.freeze({ R: 0.778, $: 0.667, ':': 0.333, ' ': 0.333, ',': 0.333, '.': 0.333 });

    function calcularFontePreco(textoPreco, larguraDisponivelMm) {
        const ems = Array.from(String(textoPreco || '')).reduce((total, c) => total + (LARGURA_EM_PRECO[c] ?? 0.667), 0);
        if (!ems) return 22;
        const pontos = ((larguraDisponivelMm * 0.95) / ems) * (72 / 25.4);
        return Math.max(10, Math.min(22, pontos));
    }

    function montarHtml(produto, svgCodigoBarras, opcoes = {}) {
        const erro = validarProduto(produto);
        if (erro) throw new Error(erro);
        const codigoBarras = String(produto.codigo_barras ?? '').trim();
        const svg = String(svgCodigoBarras || '').trim();
        if (codigoBarras && !svg.startsWith('<svg')) {
            throw new Error('Não foi possível gerar o código de barras.');
        }

        const nome = String(produto.nome).trim();
        const codigo = String(produto.codigo ?? '').trim();
        const unidade = String(produto.unidade ?? '').trim().toUpperCase();
        const nomeFontSize = calcularFonteNome(nome).toFixed(1);
        const classeEtiqueta = codigoBarras ? 'etiqueta' : 'etiqueta sem-codigo-barras';
        const htmlCodigoBarras = codigoBarras ? `<aside class="barcode-area">${svg}</aside>` : '';
        const papelMm = Number(opcoes.papelMm) === 58 ? 58 : 80;
        const areaUtilMm = papelMm === 58 ? 48 : 72;
        const larguraInternaMm = areaUtilMm - 4.5;
        const larguraPrecoMm = papelMm === 80 && codigoBarras ? larguraInternaMm - 31 : larguraInternaMm;
        const precoFontSize = calcularFontePreco(formatarPreco(produto.preco_venda), larguraPrecoMm).toFixed(1);
        const estilo58 = papelMm === 58 ? `
  .etiqueta { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto; }
  .barcode-area { grid-column: 1; grid-row: 3; border-left: 0; border-top: .2mm solid #000; padding: 1mm 0 0; margin-top: 1.5mm; }` : '';

        return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Etiqueta de produto</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .etiqueta { width: ${areaUtilMm}mm; max-width: 100%; margin: 0 auto; min-height: 31mm; padding: 2mm; border: .25mm solid #000; display: grid; grid-template-columns: minmax(0, 1fr) 29mm; grid-template-rows: auto 1fr; column-gap: 2mm; }
    .etiqueta.sem-codigo-barras { grid-template-columns: minmax(0, 1fr); }
  .nome { grid-column: 1; grid-row: 1; max-width: 100%; margin: 0 0 1.5mm; text-align: center; font-size: ${nomeFontSize}pt; line-height: 1.08; font-weight: 700; overflow-wrap: anywhere; word-break: break-word; }
  .dados { grid-column: 1; grid-row: 2; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
  .preco { margin: 0; font-size: ${precoFontSize}pt; line-height: 1; font-weight: 800; white-space: nowrap; }
  .codigo-unidade { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 4mm; row-gap: 1mm; font-size: 9pt; line-height: 1.1; font-weight: 700; overflow-wrap: anywhere; }
  .barcode-area { grid-column: 2; grid-row: 1 / 3; min-width: 0; display: flex; align-items: center; justify-content: center; border-left: .2mm solid #000; padding-left: 1mm; }
  .barcode-area svg { display: block; width: 100%; max-height: 25mm; height: auto; }
  @media print { .etiqueta { break-inside: avoid; page-break-inside: avoid; } }${estilo58}
</style>
</head>
<body>
    <main class="${classeEtiqueta}" aria-label="Etiqueta de prateleira">
    <h1 class="nome">${escaparHtml(nome)}</h1>
    <section class="dados">
      <p class="preco">${escaparHtml(formatarPreco(produto.preco_venda))}</p>
      <div class="codigo-unidade"><span>CÓD.: ${escaparHtml(codigo)}</span><span>UN.: ${escaparHtml(unidade)}</span></div>
    </section>
    ${htmlCodigoBarras}
  </main>
</body>
</html>`;
    }

    return { ERROS, validarProduto, formatarPreco, calcularFonteNome, calcularFontePreco, montarHtml };
});