/**
 * RC3.15.11 — Desacoplamento Expedição: venda_fiscal (Motor) ≠ emitir_fiscal (NFC-e).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  montarPayloadVendaDoPedido
} = require('../../backend/services/faturamento/FaturamentoService');
const {
  resolverVendaFiscalParaMotor
} = require('../../backend/services/vendas/VendaPagamentoService');
const { parseVendaFiscalFlag } = require('../../backend/services/distribuidorEstoqueVenda');

const pedidoBase = {
  id: 1,
  total: 10,
  desconto: 0,
  cliente_id: 1,
  itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 10, subtotal: 10 }]
};

describe('RC3.15.11 — payload Expedição', () => {
  it('F12 ON → venda_fiscal true e emitir_fiscal false', () => {
    const payload = montarPayloadVendaDoPedido(pedidoBase, { forma_pagamento: 'dinheiro' }, {
      vendaFiscal: true
    });
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.venda_fiscal, true);
  });

  it('F12 OFF → venda_fiscal false e emitir_fiscal false', () => {
    const payload = montarPayloadVendaDoPedido(pedidoBase, { forma_pagamento: 'pix' }, {
      vendaFiscal: false
    });
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.venda_fiscal, false);
  });

  it('sem opcoes (default) → venda_fiscal false', () => {
    const payload = montarPayloadVendaDoPedido(pedidoBase, { forma_pagamento: 'dinheiro' });
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.venda_fiscal, false);
  });

  it('faturarPedido passa vendaFiscal = modoOperacionalFiscal (fonte)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/faturamento/FaturamentoService.js'),
      'utf8'
    );
    assert.match(src, /vendaFiscal:\s*modoOperacionalFiscal/);
    assert.match(src, /venda_fiscal:\s*opcoes\.vendaFiscal\s*===\s*true/);
  });
});

describe('RC3.15.11 — resolverVendaFiscalParaMotor', () => {
  it('venda_fiscal tem precedência sobre emitir_fiscal', () => {
    assert.equal(resolverVendaFiscalParaMotor({ venda_fiscal: true, emitir_fiscal: false }), true);
    assert.equal(resolverVendaFiscalParaMotor({ venda_fiscal: false, emitir_fiscal: true }), false);
  });

  it('sem venda_fiscal → fallback emitir_fiscal (PDV)', () => {
    assert.equal(resolverVendaFiscalParaMotor({ emitir_fiscal: true }), true);
    assert.equal(resolverVendaFiscalParaMotor({ emitir_fiscal: false }), false);
    assert.equal(resolverVendaFiscalParaMotor({}), false);
  });

  it('parseVendaFiscalFlag do Motor permanece intacto', () => {
    assert.equal(parseVendaFiscalFlag(true), true);
    assert.equal(parseVendaFiscalFlag(false), false);
  });
});

describe('RC3.15.11 — isolamento', () => {
  it('não altera regras internas do Motor / emissor NFC-e / signer', () => {
    const motor = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/distribuidorEstoqueVenda.js'),
      'utf8'
    );
    assert.match(motor, /function distribuirQuantidadeVenda/);
    assert.doesNotMatch(motor, /venda_fiscal/);
    assert.ok(fs.existsSync(path.resolve(__dirname, '../../backend/services/fiscal/emissor.js')));
    assert.ok(fs.existsSync(path.resolve(__dirname, '../../backend/services/fiscal/signer.js')));
  });

  it('NF-e Avulsa também envia venda_fiscal true', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/fiscal/nfeAvulsaService.js'),
      'utf8'
    );
    assert.match(src, /venda_fiscal:\s*true/);
    assert.match(src, /emitir_fiscal:\s*false/);
  });
});
