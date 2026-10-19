/**
 * Auditoria global — todos os geradores térmicos ativos usam área útil 72/48 mm.
 * node --test tests/impressao/auditoria-global-impressoes.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');
const { GT710_80, larguraUtilMm, cssCupomTermico } = require('../../backend/services/termico/geometriaCupom80');
const { montarHtmlComprovanteEntrega } = require('../../backend/services/entrega/CriarVendaEntregaService');
const { montarHtmlComprovantePrestacao } = require('../../backend/services/entrega/ComprovantePrestacao');
const { gerarHtmlCupomFechamento } = require('../../backend/services/caixa/FechamentoCaixaCupomService');
const DanfeTermicoRenderer = require('../../backend/services/fiscal/DanfeTermicoRenderer');
const { gerarDanfeHtml } = require('../../backend/services/fiscal/danfe');
const comprovanteTermicoLayout = require('../../backend/services/entrega/comprovanteTermicoLayout');
const EtiquetaProduto = require('../../frontend/erp/js/etiquetaProduto');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function cupomNaoFiscal(papelMm = 80) {
  const codigo = ler('frontend/shared/js/fiscalImpressao.js');
  const ctx = { console, Date, window: null, globalThis: null };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(`${codigo}\nwindow.__g = montarHtmlCupomNaoFiscal;`, ctx);
  return ctx.__g(1, {
    nome_empresa: 'CDS',
    papel_mm: papelMm,
    itens: [{ produto_nome: 'ITEM', quantidade: 1, preco_unitario: 1, subtotal: 1, tipo_venda: 'UNIDADE' }]
  }, 1, 0);
}

function assertUtilTermico(html, papel) {
  const util = papel === 58 ? 48 : 72;
  assert.match(html, new RegExp(`width:\\s*${util}mm`));
  assert.match(html, new RegExp(`max-width:\\s*${util}mm`));
  assert.doesNotMatch(html, new RegExp(`(?:max-)?width:\\s*${papel}mm`));
  assert.doesNotMatch(html, new RegExp(`--danfe-width:\\s*${papel}mm`));
  assert.doesNotMatch(html, /48ch|32ch|overflow-x\s*:\s*hidden|transform:\s*scale|scaleFactor/);
}

describe('Inventário — consumidores da geometria compartilhada', () => {
  it('geometriaCupom80 declara GT710 72 mm e é usada pelos comprovantes de bobina', () => {
    assert.equal(GT710_80.utilMm, 72);
    assert.equal(larguraUtilMm(80), 72);
    assert.equal(larguraUtilMm(58), 48);
    assert.match(cssCupomTermico(80), /width:\s*72mm/);
    assert.doesNotMatch(cssCupomTermico(80), /width:\s*80mm/);

    const entrega = ler('backend/services/entrega/CriarVendaEntregaService.js');
    const prestacao = ler('backend/services/entrega/ComprovantePrestacao.js');
    const fechamento = ler('backend/services/caixa/FechamentoCaixaCupomService.js');
    assert.match(entrega, /geometriaCupom80/);
    assert.match(prestacao, /geometriaCupom80/);
    assert.match(fechamento, /geometriaCupom80/);
  });

  it('nenhum require de produção aponta para comprovanteTermicoLayout', () => {
    const hits = [];
    function walk(dir) {
      for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
        if (nome.name === 'node_modules' || nome.name === '.git' || nome.name === 'tests') continue;
        const full = path.join(dir, nome.name);
        if (nome.isDirectory()) walk(full);
        else if (nome.name.endsWith('.js') && !full.endsWith(`${path.sep}comprovanteTermicoLayout.js`)) {
          const src = fs.readFileSync(full, 'utf8');
          if (/comprovanteTermicoLayout/.test(src)) hits.push(path.relative(ROOT, full));
        }
      }
    }
    walk(path.join(ROOT, 'backend'));
    walk(path.join(ROOT, 'frontend'));
    walk(ROOT);
    assert.deepEqual(hits.filter((h) => !h.startsWith('tests') && !h.includes('electron')), []);
  });
});

describe('Família térmica — área útil obrigatória', () => {
  it('entrega 80/58', () => {
    assertUtilTermico(montarHtmlComprovanteEntrega({ id: 1, total: 10 }, [{ nome: 'A', quantidade: 1, preco_unitario: 10, subtotal: 10 }], { nome: 'Loja', papel_mm: 80 }), 80);
    assertUtilTermico(montarHtmlComprovanteEntrega({ id: 1, total: 10 }, [], { nome: 'Loja', papel_mm: 58 }), 58);
  });

  it('prestação 80/58', () => {
    assertUtilTermico(montarHtmlComprovantePrestacao({ pedido: 1, valor: 10, formas_pagamento: [], papel_mm: 80 }), 80);
    assertUtilTermico(montarHtmlComprovantePrestacao({ pedido: 1, valor: 10, formas_pagamento: [], papel_mm: 58 }), 58);
  });

  it('fechamento 80/58', () => {
    assertUtilTermico(gerarHtmlCupomFechamento({}, { papel_mm: 80 }), 80);
    assertUtilTermico(gerarHtmlCupomFechamento({}, { papel_mm: 58 }), 58);
  });

  it('não fiscal 80/58', () => {
    assertUtilTermico(cupomNaoFiscal(80), 80);
    assertUtilTermico(cupomNaoFiscal(58), 58);
  });

  it('DANFE térmico oficial 80/58', () => {
    assertUtilTermico(DanfeTermicoRenderer.gerar({ papelMm: 80, itens: [], total: 0 }).html, 80);
    assertUtilTermico(DanfeTermicoRenderer.gerar({ papelMm: 58, itens: [], total: 0 }).html, 58);
  });

  it('DANFE legado gerarDanfeHtml também usa área útil', async () => {
    const html80 = await gerarDanfeHtml({
      venda: { total: 1, pagamentos: [{ forma_pagamento: 'pix', valor: 1 }] },
      itens: [{ produto_nome: 'X', quantidade_fiscal: 1, valor_fiscal: 1, preco_unitario: 1 }],
      empresa: { nomeFantasia: 'Loja', cnpj: '00000000000000', larguraMm: 80 },
      chave: '35260112345678000199550010000000011000000001',
      numero: 1,
      serie: 1
    });
    assert.match(html80, /--danfe-width:\s*72mm/);
    assert.match(html80, /--danfe-papel:\s*80mm/);
    assert.doesNotMatch(html80, /--danfe-width:\s*80mm/);
  });

  it('etiqueta 80/58', () => {
    const p = { id: 1, nome: 'P', codigo: '1', unidade: 'UN', codigo_barras: '', preco_venda: 10 };
    assertUtilTermico(EtiquetaProduto.montarHtml(p, ''), 80);
    assertUtilTermico(EtiquetaProduto.montarHtml(p, '', { papelMm: 58 }), 58);
  });

  it('layout monospace legado (órfão) não usa mais ch no CSS', () => {
    const html = comprovanteTermicoLayout.documento({
      titulo: 'T',
      classe: 'x',
      linhas: ['A'.repeat(48)],
      papelMm: 80
    });
    assert.match(html, /width:\s*72mm/);
    assert.doesNotMatch(html, /48ch|32ch/);
  });
});

describe('Mecanismos — HTML térmico vs ESC/POS vs A4', () => {
  it('entrega/PDV usam Electron; TEF usa ESC/POS; relatórios A4 não misturam bobina', () => {
    const pdvEntrega = ler('frontend/pdv/js/pdv-venda-entrega.js');
    const impressao = ler('backend/rotas/impressao.js');
    const compras = ler('frontend/erp/js/compras-relatorio.js');
    const pedidos = ler('frontend/erp/js/pedidos.js');
    const fiscal = ler('frontend/erp/js/fiscal.js');

    assert.match(pdvEntrega, /apresentarCupomNaTela|abrirComprovante|imprimirDANFESilencioso/);
    assert.doesNotMatch(pdvEntrega, /escpos/);
    assert.match(impressao, /escpos/);
    assert.match(impressao, /\/tef/);
    assert.match(compras, /A4 portrait|size:\s*A4/);
    assert.match(pedidos, /210mm|size:\s*A4/);
    assert.match(fiscal, /apresentarCupomNaTela|abrirComprovante/);
  });

  it('Electron térmico não injeta pageSize/zoom', () => {
    for (const arq of ['electron.js', 'electron-common.js', 'electron-janelas-modulo.js']) {
      const src = ler(arq);
      assert.doesNotMatch(src, /pageSize|scaleFactor|setZoomFactor/);
      assert.match(src, /marginType:\s*'none'/);
    }
  });
});
