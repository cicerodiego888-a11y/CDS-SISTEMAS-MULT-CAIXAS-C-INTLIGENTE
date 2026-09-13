/**
 * Sprint 3.8B — MIDP V1 + Valor Fiscal Efetivo (preservação dinheiro físico)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  distribuirItemVenda,
  calcularValorFiscalEfetivo,
  distribuirItensVendaComValorFiscalEfetivo,
  obterFaixaQuantidadeFiscal
} = require('../../backend/services/distribuidorEstoqueVenda');
const midp = require('../../backend/services/midp');

describe('Sprint 3.8B — Motor Valor Fiscal Efetivo', () => {
  it('faixa fiscal: min = o que não cabe no NF; max = cabe no fiscal', () => {
    const f = obterFaixaQuantidadeFiscal(105, 55, 55);
    assert.equal(f.sucesso, true);
    assert.equal(f.quantidadeFiscalMin, 50);
    assert.equal(f.quantidadeFiscalMax, 55);
  });

  it('MIDP off: efetivo = máximo (legado)', () => {
    const r = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 550,
      valorFiscalMinimo: 500,
      totalVenda: 1050,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 500 },
        { forma_pagamento: 'dinheiro', valor: 550 }
      ],
      midpAtivo: false
    });
    assert.equal(r.valorFiscalEfetivo, 550);
    assert.equal(r.preservacaoAplicada, false);
  });

  it('exemplo oficial: máx 550 → efetivo 500 com PIX+dinheiro e MIDP on', () => {
    const r = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 550,
      valorFiscalMinimo: 500,
      totalVenda: 1050,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 500 },
        { forma_pagamento: 'dinheiro', valor: 550 }
      ],
      midpAtivo: true
    });
    assert.equal(r.valorFiscalEfetivo, 500);
    assert.equal(r.valorNaoFiscal, 550);
    assert.equal(r.preservacaoAplicada, true);
  });

  it('produto fiscal suficiente / sem dinheiro: sem alteração', () => {
    const r = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 550,
      valorFiscalMinimo: 0,
      totalVenda: 1050,
      pagamentos: [{ forma_pagamento: 'pix', valor: 1050 }],
      midpAtivo: true
    });
    assert.equal(r.valorFiscalEfetivo, 550);
    assert.equal(r.preservacaoAplicada, false);
  });

  it('pipeline itens: preserva total e reduz fiscal efetivo', () => {
    const item = { produto_id: 1, quantidade: 105, preco_unitario: 10, subtotal: 1050 };
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 55, saldoNaoFiscal: 55 }],
      true,
      {
        midpAtivo: true,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 500 },
          { forma_pagamento: 'dinheiro', valor: 550 }
        ]
      }
    );
    assert.equal(out.sucesso, true);
    assert.equal(out.valorFiscalMaximo, 550);
    assert.equal(out.valorFiscalMinimo, 500);
    assert.equal(out.valorFiscalEfetivo, 500);
    assert.equal(out.valorNaoFiscal, 550);
    assert.equal(out.totalVenda, 1050);
    assert.equal(out.preservacaoAplicada, true);
    const soma = Number(out.itens[0].valor_fiscal) + Number(out.itens[0].valor_nao_fiscal);
    assert.equal(Number(soma.toFixed(2)), 1050);
  });

  it('legado distribuirItemVenda inalterado (prioriza fiscal)', () => {
    const r = distribuirItemVenda(
      { quantidade: 105, preco_unitario: 10 },
      55,
      55,
      true
    );
    assert.equal(r.sucesso, true);
    assert.equal(r.quantidadeFiscal, 55);
    assert.equal(r.valorFiscal, 550);
  });
});

describe('Sprint 3.8B — MIDP consome só efetivo', () => {
  it('PIX → fiscal; dinheiro → NF no cenário 500/550', () => {
    const r = midp.executar({
      pagamentosComerciais: [
        { forma_pagamento: 'dinheiro', valor: 550 },
        { forma_pagamento: 'pix', valor: 500 }
      ],
      valorFiscalEfetivo: 500,
      valorNaoFiscal: 550
    });
    assert.equal(r.saldoFiscal, 0);
    assert.equal(r.saldoNaoFiscal, 0);
    const pixF = r.pagamentoFiscal.find((p) => p.forma_pagamento === 'pix');
    const dinNf = r.pagamentoNaoFiscal.find((p) => p.forma_pagamento === 'dinheiro');
    assert.ok(pixF);
    assert.equal(pixF.valor, 500);
    assert.ok(dinNf);
    assert.equal(dinNf.valor, 550);
  });

  it('cenários mistos / cartão / só fiscal sem regressão de alocação', () => {
    const soFiscal = midp.distribuirPagamentos(
      [{ forma_pagamento: 'pix', valor: 100 }],
      100,
      0
    );
    assert.equal(soFiscal.recebimentosFiscal[0].valor, 100);
    assert.equal(soFiscal.recebimentosNaoFiscal.length, 0);

    const soNf = midp.distribuirPagamentos(
      [{ forma_pagamento: 'dinheiro', valor: 80 }],
      0,
      80
    );
    assert.equal(soNf.recebimentosNaoFiscal[0].valor, 80);

    const misto = midp.distribuirPagamentos(
      [
        { forma_pagamento: 'cartao_credito', valor: 40 },
        { forma_pagamento: 'dinheiro', valor: 60 }
      ],
      40,
      60
    );
    assert.equal(misto.saldoFiscal, 0);
    assert.equal(misto.saldoNaoFiscal, 0);
  });
});

describe('Sprint 3.8B — soberania e docs', () => {
  it('emissores NF-e/NFC-e não foram alterados nesta sprint', () => {
    const root = path.join(__dirname, '../..');
    // smoke: arquivos existem e ainda filtram fiscal
    const nfe = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilderNfeVenda.js'), 'utf8');
    const nfce = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilder.js'), 'utf8');
    assert.match(nfe, /quantidade_fiscal|itemEntraNaNfe/);
    assert.match(nfce, /obterValorFiscalItem|quantidade_fiscal/);
  });

  it('Motor exporta API de efetivo', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/distribuidorEstoqueVenda.js'),
      'utf8'
    );
    assert.match(src, /calcularValorFiscalEfetivo/);
    assert.match(src, /distribuirItensVendaComValorFiscalEfetivo/);
    assert.match(src, /Valor Fiscal Efetivo/);
  });
});
