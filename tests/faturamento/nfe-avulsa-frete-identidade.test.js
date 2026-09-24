'use strict';

/**
 * Sprint — NF-e Avulsa / frete + diagnóstico 400.
 * Executar: node --test tests/faturamento/nfe-avulsa-frete-identidade.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  validarIdentidadeFinanceiraVenda
} = require('../../backend/services/caixa/ValidacaoIdentidadeVenda');
const { montarPayloadVendaAvulsa } = require('../../backend/services/fiscal/nfeAvulsaService');
const { validarSomaPagamentosVenda } = require('../../backend/services/vendas/VendaFinanceiroService');

describe('NF-e Avulsa — identidade com frete', () => {
  it('sem frete continua ok (legado PDV / avulsa)', () => {
    const v = validarIdentidadeFinanceiraVenda({
      total: 100,
      valorFiscal: 100,
      valorNaoFiscal: 0,
      itens: [{ subtotal: 100 }],
      desconto: 0,
      acrescimo: 0,
      frete: 0,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }],
      statusPagamento: 'quitada'
    });
    assert.equal(v.ok, true);
  });

  it('frete > 0 não falha por identidade (itens + frete − desconto)', () => {
    const v = validarIdentidadeFinanceiraVenda({
      total: 115,
      valorFiscal: 100,
      valorNaoFiscal: 0,
      itens: [{ subtotal: 100 }],
      desconto: 0,
      acrescimo: 0,
      frete: 15,
      pagamentos: [{ forma_pagamento: 'pix', valor: 115 }],
      statusPagamento: 'quitada'
    });
    assert.equal(v.ok, true);
  });

  it('total = itens + frete − desconto', () => {
    // Motor já devolve valor fiscal líquido do desconto; frete só na conferência
    const v = validarIdentidadeFinanceiraVenda({
      total: 108,
      valorFiscal: 93,
      valorNaoFiscal: 0,
      itens: [{ quantidade: 2, preco_unitario: 50 }],
      desconto: 7,
      acrescimo: 0,
      frete: 15
    });
    assert.equal(v.ok, true);

    const falha = validarIdentidadeFinanceiraVenda({
      total: 120,
      valorFiscal: 100,
      valorNaoFiscal: 0,
      itens: [{ subtotal: 100 }],
      frete: 15
    });
    assert.equal(falha.ok, false);
    assert.match(falha.erro, /não confere com os itens/);
  });

  it('frete não é contado duas vezes (frete + mesmo valor em acréscimo falha se total só tem um)', () => {
    // total = 100 + 15 frete = 115; se alguém somasse frete duas vezes esperaria 130
    const okUmaVez = validarIdentidadeFinanceiraVenda({
      total: 115,
      valorFiscal: 100,
      valorNaoFiscal: 0,
      itens: [{ subtotal: 100 }],
      frete: 15,
      acrescimo: 0
    });
    assert.equal(okUmaVez.ok, true);

    const duplicadoNoTotal = validarIdentidadeFinanceiraVenda({
      total: 130,
      valorFiscal: 100,
      valorNaoFiscal: 0,
      itens: [{ subtotal: 100 }],
      frete: 15,
      acrescimo: 0
    });
    assert.equal(duplicadoNoTotal.ok, false);
  });

  it('pagamentos continuam tendo que fechar com o total (inclui frete)', () => {
    const total = 115;
    const ok = validarSomaPagamentosVenda(
      [{ forma_pagamento: 'dinheiro', valor: 115 }],
      total,
      { valor_fiscal: 115, valor_nao_fiscal: 0 }
    );
    assert.equal(ok, null);

    const ruim = validarSomaPagamentosVenda(
      [{ forma_pagamento: 'dinheiro', valor: 100 }],
      total,
      { valor_fiscal: 115, valor_nao_fiscal: 0 }
    );
    assert.ok(ruim);
  });
});

describe('NF-e Avulsa — montarPayload + rota 400', () => {
  it('payload: total = itens + frete − desconto; frete uma vez (top-level = dadosNfe)', () => {
    const p = montarPayloadVendaAvulsa({
      itens: [{ produto_id: 1, quantidade: 2, preco_unitario: 50 }],
      frete: 15,
      desconto: 5,
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: 110 }]
    });
    assert.equal(p.total, 110);
    assert.equal(p.frete, 15);
    assert.equal(p.desconto, 5);
    assert.equal(p.dadosNfe.frete, 15);
    assert.equal(p.frete, p.dadosNfe.frete);
    // Não duplica: itens 100 + frete 15 − desc 5 = 110 (não 125)
    assert.notEqual(p.total, 125);
  });

  it('sem frete: total = subtotal dos itens', () => {
    const p = montarPayloadVendaAvulsa({
      itens: [{ produto_id: 1, quantidade: 2, preco_unitario: 5 }],
      forma_pagamento: 'dinheiro'
    });
    assert.equal(p.total, 10);
    assert.equal(p.frete, 0);
  });

  it('rota /avulsa preserva mensagem de validação no HTTP 400', () => {
    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/nfe.js'), 'utf8');
    assert.match(rota, /VALIDACAO_NFE_AVULSA|status === 400/);
    assert.match(rota, /err\.message/);
    assert.match(rota, /err\.body\?\.error/);
    // Não mascara 400 com classificarErro genérico no bloco avulsa
    const blocoAvulsa = rota.slice(rota.indexOf("router.post('/avulsa'"), rota.indexOf('function enviarErroAmigavel'));
    assert.match(blocoAvulsa, /status === 400/);
    assert.doesNotMatch(blocoAvulsa, /enviarErroAmigavel\(res, err, err\.statusCode/);
  });
});
