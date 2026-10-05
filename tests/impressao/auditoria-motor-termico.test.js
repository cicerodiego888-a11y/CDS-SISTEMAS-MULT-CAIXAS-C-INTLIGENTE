/**
 * Motor de impressão térmica — geometria 58/80mm (área útil ~48/72mm).
 * Compara HTML original × HTML final de enriquecerHtmlImpressaoTermica e a geometria dos templates.
 * Testes de string não provam impressão física.
 * Executar: node --test tests/impressao/auditoria-motor-termico.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { enriquecerHtmlImpressaoTermica } = require('../../electron-janelas-modulo');
const DanfeTermicoRenderer = require('../../backend/services/fiscal/DanfeTermicoRenderer');
const { gerarHtmlCupomFechamento } = require('../../backend/services/caixa/FechamentoCaixaCupomService');
const EtiquetaProduto = require('../../frontend/erp/js/etiquetaProduto');

const ROOT = path.join(__dirname, '../..');
const PAGE_RE = /@page\s*\{[^}]*\}/gi;
const PAGE_SO_MARGEM = /@page\s*\{\s*margin:\s*0;\s*\}/;
const CONSOLAS_CH_MM = 0.5498 * 10 * 25.4 / 96;

function regrasPage(html) {
  return html.match(PAGE_RE) || [];
}

function sizeDasRegras(html) {
  return regrasPage(html).map((regra) => {
    const m = regra.match(/size\s*:\s*([^;}]+)/i);
    return m ? m[1].trim() : null;
  });
}

function semEstiloDoEnhancer(html) {
  return html.replace(/\s*<style id="cds-print-density">[\s\S]*?<\/style>\s*/i, '');
}

/** Gramática CSS Paged Media: size = <length>{1,2} | auto | [<page-size> || orientation]. */
function sizeValidoPelaGramatica(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (v === 'auto') return true;
  const partes = v.split(/\s+/);
  const ehComprimento = (p) => /^\d+(\.\d+)?(mm|cm|in|px|pt|pc|q)$/.test(p);
  if (partes.length >= 1 && partes.length <= 2 && partes.every(ehComprimento)) return true;
  const nomes = ['a5', 'a4', 'a3', 'b5', 'b4', 'letter', 'legal', 'ledger', 'portrait', 'landscape'];
  return partes.length <= 2 && partes.every((p) => nomes.includes(p));
}

function carregarFrontend(arquivo, exportar) {
  const codigo = fs.readFileSync(path.join(ROOT, arquivo), 'utf8');
  const ctx = { console, Date, window: null, globalThis: null, document: { querySelectorAll: () => [] } };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(`${codigo}\n${exportar}`, ctx);
  return ctx;
}

function gerarCupomNaoFiscal(extra = {}) {
  const ctx = carregarFrontend('frontend/shared/js/fiscalImpressao.js', 'window.__gerarCupom = montarHtmlCupomNaoFiscal;');
  return ctx.__gerarCupom(42, {
    nome_empresa: 'CDS',
    itens: [{ produto_nome: 'PRODUTO TESTE', quantidade: 1, preco_unitario: 10, subtotal: 10 }],
    ...extra
  }, 10, 0);
}

function dadosDanfeTermico(papelMm) {
  return {
    papelMm,
    nomeFantasia: 'CDS',
    itens: [{ codigo: '1', nome: 'PRODUTO TESTE', quantidade: 1, precoUnitario: 10, subtotal: 10 }],
    total: 10,
    chave: '23260865957340000150650010000100161433162957',
    qrCodeDataUrl: 'data:image/png;base64,AA=='
  };
}

describe('Motor térmico — 10 cenários HTML original × final', () => {
  it('1. marcador 58mm: só @page margin 0 e body intacto', () => {
    const original = '<html><head></head><body class="danfe-termico-58">DANFE</body></html>';
    const final = enriquecerHtmlImpressaoTermica(original);
    assert.deepEqual(sizeDasRegras(original), []);
    assert.deepEqual(sizeDasRegras(final), [null]);
    assert.match(final, PAGE_SO_MARGEM);
    assert.ok(final.includes('<body class="danfe-termico-58">DANFE</body>'));
  });

  it('2. marcador 80mm: só @page margin 0', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head></head><body class="danfe-80">X</body></html>');
    assert.deepEqual(sizeDasRegras(final), [null]);
  });

  it('3. sem marcador de largura: só @page margin 0', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head></head><body><p>X</p></body></html>');
    assert.deepEqual(sizeDasRegras(final), [null]);
    assert.match(final, PAGE_SO_MARGEM);
  });

  it('4. @page existente: preservado byte a byte, sem segunda regra', () => {
    const original = '<html><head><style>@page { margin: 0; }</style></head><body>X</body></html>';
    const final = enriquecerHtmlImpressaoTermica(original);
    assert.equal(regrasPage(final).length, 1);
    assert.equal(semEstiloDoEnhancer(final), original);
  });

  it('5. @page size:auto: mantido como auto (válido), sem conversão para "Nmm auto"', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head><style>@page { size: auto; margin: 0; }</style></head><body>X</body></html>');
    assert.deepEqual(sizeDasRegras(final), ['auto']);
    assert.doesNotMatch(final, /\d+mm auto/);
  });

  it('6. <pre> com width:300px de terceiros: largura preservada pelo enhancer', () => {
    const original = '<html><head></head><body><pre style="width: 300px; white-space: pre-wrap">CUPOM</pre></body></html>';
    const final = enriquecerHtmlImpressaoTermica(original);
    assert.match(final, /<pre style="width: 300px; white-space: pre-wrap">CUPOM<\/pre>/);
  });

  it('7. tabela: width/table-layout preservados', () => {
    const original = '<html><head><style>table.items{width:100%;table-layout:fixed}</style></head><body><table class="items"><tr><td>A</td></tr></table></body></html>';
    const final = enriquecerHtmlImpressaoTermica(original);
    assert.match(final, /table\.items\{width:100%;table-layout:fixed\}/);
  });

  it('8. texto longo: conteúdo integral preservado', () => {
    const longo = 'DESCRICAO MUITO LONGA '.repeat(40);
    const final = enriquecerHtmlImpressaoTermica(`<html><head></head><body><div>${longo}</div></body></html>`);
    assert.ok(final.includes(longo));
  });

  it('9. QR Code: <img> preservada; enhancer só aplica filtro de contraste', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head></head><body><div class="qr"><img src="data:image/png;base64,AA==" style="width:42mm"></div></body></html>');
    assert.match(final, /<img src="data:image\/png;base64,AA==" style="width:42mm">/);
    assert.match(final, /filter:\s*contrast\(1\.45\)\s*brightness\(0\.78\)/);
  });

  it('10. rodapé: preservado ao final do documento', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head></head><body><p>X</p><footer>RODAPE FINAL</footer></body></html>');
    assert.match(final, /<footer>RODAPE FINAL<\/footer><\/body><\/html>$/);
  });
});

describe('Motor térmico — contrato do enhancer', () => {
  it('não injeta width, max-width, height, overflow, margin ou padding em body/conteúdo', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head></head><body><p>X</p></body></html>');
    const estilo = final.match(/<style id="cds-print-density">([\s\S]*?)<\/style>/i)[1].replace(PAGE_RE, '');
    assert.doesNotMatch(estilo, /(?:^|[\s;{])(?:max-)?(?:width|height)\s*:/i);
    assert.doesNotMatch(estilo, /\b(?:overflow|margin|padding)\s*:/i);
  });

  it('fora do estilo próprio, o HTML original permanece idêntico', () => {
    const original = '<html><head><title>T</title></head><body><pre style="width:300px">A</pre></body></html>';
    assert.equal(semEstiloDoEnhancer(enriquecerHtmlImpressaoTermica(original)), original);
  });

  it('nenhum template térmico termina com @page size inválido para o Chromium', () => {
    const documentos = [
      gerarCupomNaoFiscal(), gerarCupomNaoFiscal({ papel_mm: 58 }),
      DanfeTermicoRenderer.gerar(dadosDanfeTermico(80)).html, DanfeTermicoRenderer.gerar(dadosDanfeTermico(58)).html,
      gerarHtmlCupomFechamento({}), gerarHtmlCupomFechamento({}, { papel_mm: 58 }),
      EtiquetaProduto.montarHtml({ id: 1, nome: 'P', codigo: '1', unidade: 'UN', codigo_barras: '', preco_venda: 10 }, ''),
      EtiquetaProduto.montarHtml({ id: 1, nome: 'P', codigo: '1', unidade: 'UN', codigo_barras: '', preco_venda: 10 }, '', { papelMm: 58 })
    ];
    for (const original of documentos) {
      const final = enriquecerHtmlImpressaoTermica(original);
      assert.equal(regrasPage(final).length, 1);
      assert.match(final, PAGE_SO_MARGEM);
      for (const size of sizeDasRegras(final)) {
        if (size !== null) assert.equal(sizeValidoPelaGramatica(size), true, `size "${size}" inválido`);
      }
    }
  });
});

describe('Motor térmico — geometria dos templates reais', () => {
  it('cupom não fiscal 80mm: documento completo, 48 colunas a 10px (~69,8mm ≤ 72mm)', () => {
    const final = enriquecerHtmlImpressaoTermica(gerarCupomNaoFiscal());
    assert.match(final, /<body class="cupom-nao-fiscal-80">/);
    assert.match(final, /width:\s*48ch/);
    assert.match(final, /font-size:\s*10px/);
    assert.ok(48 * CONSOLAS_CH_MM <= 72);
    assert.doesNotMatch(final, /width:\s*300px/);
  });

  it('cupom não fiscal 58mm: 32 colunas (~46,5mm ≤ 48mm) e textos preservados', () => {
    const final = enriquecerHtmlImpressaoTermica(gerarCupomNaoFiscal({ papel_mm: 58 }));
    assert.match(final, /<body class="cupom-nao-fiscal-58">/);
    assert.match(final, /width:\s*32ch/);
    assert.ok(32 * CONSOLAS_CH_MM <= 48);
    for (const trecho of ['COMPROVANTE NÃO FISCAL', 'Venda #42', 'PRODUTO TESTE', 'Total: R$ 10,00', 'ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL', 'VOLTE SEMPRE.']) {
      assert.ok(final.includes(trecho), `conteúdo ausente: ${trecho}`);
    }
    assert.ok(final.includes('Item         Qtd Vl.Unit Total'));
  });

  it('DANFE térmico: 48/32 colunas a 10px com padding lateral 0,5mm cabem em 72/48mm', () => {
    for (const [papel, cols, util] of [[80, 48, 72], [58, 32, 48]]) {
      const final = enriquecerHtmlImpressaoTermica(DanfeTermicoRenderer.gerar(dadosDanfeTermico(papel)).html);
      assert.match(final, new RegExp(`width:\\s*${cols}ch`));
      assert.match(final, /font-size:\s*10px/);
      assert.match(final, /padding:\s*1\.5mm 0\.5mm 2mm/);
      assert.match(final, /pre\.termico,\s*\.qr\s*\{[^}]*margin:\s*0;/);
      assert.doesNotMatch(final, /pre\.termico\s*\{[^}]*margin:\s*0\s+auto/);
      assert.doesNotMatch(final, new RegExp(`width:\\s*${papel}mm`));
      assert.ok(cols * CONSOLAS_CH_MM + 1 <= util, `${papel}mm excede a área útil`);
      assert.match(final, /QR Code NFC-e/);
    }
  });

  it('fechamento de caixa: pre na área útil, valor inteiro e nenhuma linha maior que a coluna', () => {
    const amostra = {
      totais: { recebido: 1234.56, vendido: 1234.56 },
      pagamentos: { dinheiro: 1234.56 },
      pagamentos_contagem: { dinheiro: 2 },
      dinheiro: { esperado: 1234.56, informado: 1224.06, diferenca: -10.5 },
      operador: { nome: 'Operador Com Nome Grande Demais Para Uma Linha Estreita' }
    };
    const f80 = gerarHtmlCupomFechamento(amostra);
    const f58 = gerarHtmlCupomFechamento(amostra, { papel_mm: 58 });
    assert.match(f80, /width:\s*48ch/);
    assert.match(f80, /max-width:\s*48ch/);
    assert.match(f80, /font-size:\s*10px/);
    assert.match(f80, /white-space:\s*pre;/);
    assert.match(f80, /margin:\s*0;/);
    assert.match(f58, /width:\s*32ch/);
    assert.doesNotMatch(f80, /display:\s*flex/);
    assert.doesNotMatch(f80, /text-overflow:\s*ellipsis/);
    assert.doesNotMatch(f80, /width:\s*72mm/);
    assert.doesNotMatch(f80, /width:\s*80mm/);
    for (const [html, cols] of [[f80, 48], [f58, 32]]) {
      assert.ok(html.includes('FECHAMENTO DE CAIXA'));
      assert.ok(html.includes('1.234,56'), 'valor monetário preservado');
      const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      for (const linha of pre.split('\n')) {
        assert.ok(linha.length <= cols, `linha com ${linha.length} cols: ${linha}`);
      }
      assert.ok(pre.split('\n').some((linha) => linha.endsWith('1.234,56')));
    }
  });

  it('etiqueta: bloco na área útil; 58mm em coluna única com barcode abaixo', () => {
    const produto = { id: 1, nome: 'Produto', codigo: '1', unidade: 'UN', codigo_barras: '7891234567890', preco_venda: 10 };
    const e80 = EtiquetaProduto.montarHtml(produto, '<svg viewBox="0 0 100 30"></svg>');
    const e58 = EtiquetaProduto.montarHtml(produto, '<svg viewBox="0 0 100 30"></svg>', { papelMm: 58 });
    assert.match(e80, /\.etiqueta \{ width: 72mm; max-width: 100%;/);
    assert.match(e80, /grid-template-columns: minmax\(0, 1fr\) 29mm/);
    assert.match(e58, /\.etiqueta \{ width: 48mm; max-width: 100%;/);
    assert.match(e58, /\.barcode-area \{ grid-column: 1; grid-row: 3;/);
  });

  it('etiqueta: fonte do preço reduz conforme o valor e a coluna, limitada a 10–22pt', () => {
    const { calcularFontePreco, formatarPreco } = EtiquetaProduto;
    assert.equal(calcularFontePreco(formatarPreco(1), 67.5), 22);
    const coluna80 = 36.5;
    const pequeno = calcularFontePreco(formatarPreco(10), coluna80);
    const grande = calcularFontePreco(formatarPreco(99999.99), coluna80);
    assert.ok(grande < pequeno && pequeno <= 22 && grande >= 10);
    assert.equal(calcularFontePreco('R$: 9999999999999,99', 10), 10);

    const produto = { id: 1, nome: 'P', codigo: '1', unidade: 'UN', codigo_barras: '7891234567890', preco_venda: 99999.99 };
    const html = EtiquetaProduto.montarHtml(produto, '<svg viewBox="0 0 100 30"></svg>');
    const fonte = Number(html.match(/\.preco \{ margin: 0; font-size: ([\d.]+)pt;/)[1]);
    assert.equal(fonte, Number(grande.toFixed(1)));
    assert.ok(fonte < 22);
  });
});

describe('Motor térmico — largura configurada (fiscal_danfe_largura_mm)', () => {
  async function papelDaConfiguracao(configs, ok = true) {
    const ctx = carregarFrontend('frontend/shared/js/fiscalImpressao.js', 'window.__empresa = obterDadosEmpresaCupom;');
    ctx.API_URL = 'http://api';
    ctx.localStorage = { getItem: () => 'token' };
    ctx.fetch = async () => ({ ok, json: async () => configs });
    return (await ctx.__empresa()).papel_mm;
  }

  it('cupom não fiscal e etiqueta: obterDadosEmpresaCupom devolve 58 só quando configurado', async () => {
    assert.equal(await papelDaConfiguracao([{ chave: 'fiscal_danfe_largura_mm', valor: '58' }]), 58);
    assert.equal(await papelDaConfiguracao([{ chave: 'fiscal_danfe_largura_mm', valor: '80' }]), 80);
    assert.equal(await papelDaConfiguracao([]), 80);
    assert.equal(await papelDaConfiguracao([], false), undefined);
  });

  it('etiqueta: produtos.js repassa a largura configurada ao template', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(src, /EtiquetaProduto\.montarHtml\(produto, svgCodigoBarras, \{ papelMm: empresaCupom\?\.papel_mm \}\)/);
  });

  it('fechamento de caixa: rota lê a configuração e repassa papel_mm no fechamento e nas reimpressões', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/caixa.js'), 'utf8');
    assert.match(src, /chave IN \([^)]*'fiscal_danfe_largura_mm'\)/);
    assert.match(src, /papel_mm: Number\(map\.fiscal_danfe_largura_mm\) === 58 \? 58 : 80/);
    const chamadas = src.split('gerarHtmlCupomFechamento(').slice(1);
    assert.equal(chamadas.length, 2);
    for (const chamada of chamadas) {
      assert.match(chamada.slice(0, chamada.indexOf('});')), /papel_mm: meta\.papel_mm/);
    }
    assert.match(src, /finalizarComHtml\(consolidacaoSalva, cfgErr \? \{\} : \{ papel_mm: empresa\.papel_mm \}\)/);
  });
});

describe('Motor térmico — preparação no Electron e via', () => {
  it('abrir-comprovante injeta só @page margin 0 e área útil 72/48mm no DANFE de tela', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron-janelas-modulo.js'), 'utf8');
    assert.match(src, /const utilMm = papelMm === '58' \? '48' : '72';/);
    assert.match(src, /const htmlTela = papelMatch/);
    assert.doesNotMatch(src, /mm auto/);
    assert.doesNotMatch(src, /\bsize\s*:\s*\$\{/);
  });

  it('webContents.print continua sem pageSize (Sprint 2)', () => {
    for (const arquivo of ['electron.js', 'electron-janelas-modulo.js', 'electron-common.js']) {
      const src = fs.readFileSync(path.join(ROOT, arquivo), 'utf8');
      assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /pageSize/, arquivo);
    }
  });

  it('faixa da via: três linhas preservadas, 32 traços em Consolas 10px (~46,5mm ≤ 48mm)', () => {
    const ctx = carregarFrontend('frontend/shared/js/cupomPrintPolicy.js', '');
    const html = ctx.CupomPrintPolicy.enveloparVia('<html><body class="x"><pre>A</pre></body></html>', 'cliente');
    assert.match(html, /<body class="x"><div class="cds-ui-cupom-via"/);
    assert.match(html, /font-family:Consolas,'Courier New',monospace;font-size:10px;/);
    assert.match(html, /white-space:pre-line;/);
    assert.ok(32 * CONSOLAS_CH_MM <= 48);
  });
});
