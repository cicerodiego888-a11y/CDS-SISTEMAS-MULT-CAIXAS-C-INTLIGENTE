/**
 * Padronização do recuo da coluna monetária em cupons térmicos.
 * node --test tests/impressao/coluna-valor-termico.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const {
  COLUNA_VALOR_TERMICO,
  cssCupomTermico,
  cssColunaValorTermico,
  paddingCupomTermico,
  paddingValorTermico
} = require('../../backend/services/termico/geometriaCupom80');
const { montarHtmlComprovanteEntrega } = require('../../backend/services/entrega/CriarVendaEntregaService');
const { montarHtmlComprovantePrestacao } = require('../../backend/services/entrega/ComprovantePrestacao');
const { gerarHtmlCupomFechamento } = require('../../backend/services/caixa/FechamentoCaixaCupomService');
const DanfeTermicoRenderer = require('../../backend/services/fiscal/DanfeTermicoRenderer');
const { gerarDanfeHtml } = require('../../backend/services/fiscal/danfe');

function cupomNaoFiscal() {
  const codigo = fs.readFileSync(
    path.join(__dirname, '../../frontend/shared/js/fiscalImpressao.js'),
    'utf8'
  );
  const ctx = { console, Date, window: null, globalThis: null };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(`${codigo}\nwindow.__g = montarHtmlCupomNaoFiscal;`, ctx);
  return ctx.__g(7, {
    nome_empresa: 'CREMOLÍCIA',
    forma_pagamento: 'dinheiro',
    valor_recebido: 50,
    troco: 4.1,
    itens: [{
      produto_nome: 'PRODUTO COM NOME MUITO LONGO PARA NAO EMPURRAR O VALOR',
      quantidade: 1,
      preco_unitario: 45.9,
      subtotal: 45.9,
      tipo_venda: 'UNIDADE'
    }]
  }, 45.9, 0);
}

function assertRecuoValor(html, papel = 80) {
  const padCupom = papel === 58
    ? COLUNA_VALOR_TERMICO.paddingCupom58
    : COLUNA_VALOR_TERMICO.paddingCupom80;
  const padValor = papel === 58
    ? COLUNA_VALOR_TERMICO.valorPaddingRight58
    : COLUNA_VALOR_TERMICO.valorPaddingRight80;
  assert.match(html, new RegExp(`padding:\\s*${padCupom.replace(/\./g, '\\.')}`));
  assert.match(html, new RegExp(`padding-right:\\s*${padValor.replace(/\./g, '\\.')}`));
  assert.match(html, /max-width:\s*50%/);
}

describe('COLUNA_VALOR_TERMICO — regra compartilhada', () => {
  it('constantes e helpers', () => {
    assert.equal(paddingCupomTermico(80), '1.2mm 3.5mm 2mm 2mm');
    assert.equal(paddingCupomTermico(58), '1mm 2.5mm 1.6mm 1.5mm');
    assert.equal(paddingValorTermico(80), '1.5mm');
    assert.equal(paddingValorTermico(58), '1.2mm');
    assert.match(cssColunaValorTermico(80), /padding-right:\s*1\.5mm/);
    assert.match(cssCupomTermico(80), /padding:\s*1\.2mm 3\.5mm 2mm 2mm/);
    assert.match(cssCupomTermico(80), /padding-right:\s*1\.5mm/);
    // Tipografia base preservada
    assert.match(cssCupomTermico(80), /font-size:\s*11px/);
    assert.match(cssCupomTermico(80), /\.titulo \{[^}]*font-size:\s*16px/);
  });
});

describe('Templates com geometria compartilhada', () => {
  it('entrega, prestação e fechamento recuam .valor', () => {
    const entrega = montarHtmlComprovanteEntrega(
      { id: 1, total: 45.9, taxa_entrega: 5, pagamento_previsto: 'DINHEIRO', troco_para: 50 },
      [{ nome: 'ITEM LONGO '.repeat(8), quantidade: 2, preco_unitario: 20.45, subtotal: 40.9 }],
      { nome: 'LOJA', papel_mm: 80 }
    );
    const prestacao = montarHtmlComprovantePrestacao({
      pedido: 1,
      valor: 45.9,
      formas_pagamento: [{ forma_pagamento: 'PIX', valor: 45.9 }],
      troco_devolvido: 4.1,
      papel_mm: 80
    });
    const fechamento = gerarHtmlCupomFechamento({
      totais: { recebido: 1234.56, vendido: 1234.56 },
      pagamentos: { dinheiro: 1234.56 },
      dinheiro: { esperado: 1234.56, informado: 1220.06, diferenca: -14.5 }
    }, { papel_mm: 80 });

    for (const html of [entrega, prestacao, fechamento]) {
      assertRecuoValor(html, 80);
      assert.match(html, /class="valor"/);
    }
    assert.ok(entrega.includes('45,90') || entrega.includes('40,90'));
    assert.ok(fechamento.includes('1.234,56'));
  });
});

describe('Templates independentes adaptados', () => {
  it('cupom não fiscal (referência visual) espelha o recuo', () => {
    const html = cupomNaoFiscal();
    assertRecuoValor(html, 80);
    assert.match(html, /45,90/);
    assert.match(html, /Valor entregue:|Troco:/);
    assert.match(html, /font-size:\s*11px/);
    assert.match(html, /font-size:\s*16px/);
  });

  it('DANFE térmico oficial recua item-tot e última coluna da row', () => {
    const html = DanfeTermicoRenderer.gerar({
      papelMm: 80,
      nomeFantasia: 'LOJA',
      itens: [{ codigo: '1', nome: 'PICOLE LONGO '.repeat(6), quantidade: 1, precoUnitario: 12.34, subtotal: 12.34 }],
      total: 12.34,
      desconto: 1.11,
      pagamentos: [{ forma_pagamento: 'pix', valor: 11.23 }],
      chave: '23260865957340000150650010000100161433162957'
    }).html;
    assertRecuoValor(html, 80);
    assert.match(html, /\.item-tot/);
    assert.match(html, /12,34|R\$ 12,34/);
  });

  it('DANFE legado gerarDanfeHtml recua col-vl/col-tot e rows', async () => {
    const html = await gerarDanfeHtml({
      venda: { total: 20.5, desconto: 0.5, pagamentos: [{ forma_pagamento: 'pix', valor: 20 }] },
      itens: [{
        produto_nome: 'Arroz Tipo 1 Extra Longo',
        quantidade_fiscal: 2,
        valor_fiscal: 20.5,
        preco_unitario: 10.25
      }],
      empresa: { nomeFantasia: 'Loja', cnpj: '00000000000000', larguraMm: 80 },
      chave: '35260112345678000199550010000000011000000001',
      numero: 1,
      serie: 1
    });
    assert.match(html, /padding:\s*1\.2mm 3\.5mm 2mm 2mm/);
    assert.match(html, /\.col-tot \{[^}]*padding-right:\s*1\.5mm/);
    assert.match(html, /\.row span:last-child \{[^}]*padding-right:\s*1\.5mm/);
  });

  it('58 mm usa recuo próprio sem reduzir tipografia base do 80', () => {
    const css58 = cssCupomTermico(58);
    assert.match(css58, /padding:\s*1mm 2\.5mm 1\.6mm 1\.5mm/);
    assert.match(css58, /padding-right:\s*1\.2mm/);
    const danfe58 = DanfeTermicoRenderer.gerar({ papelMm: 58, itens: [], total: 0 }).html;
    assert.match(danfe58, /padding-right:\s*1\.2mm/);
  });
});
