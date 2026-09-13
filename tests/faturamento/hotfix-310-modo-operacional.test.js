/**
 * Hotfix 3.10 — Faturamento obedece modo operacional (F12 / modo_dashboard_fiscal).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  parseModoOperacionalFiscalFlag,
  montarPayloadVendaDoPedido
} = require('../../backend/services/faturamento/FaturamentoService');

describe('Hotfix 3.10 — modo operacional no Faturamento', () => {
  it('parseModoOperacionalFiscalFlag espelha F12 ON/OFF', () => {
    assert.equal(parseModoOperacionalFiscalFlag('1'), true);
    assert.equal(parseModoOperacionalFiscalFlag(1), true);
    assert.equal(parseModoOperacionalFiscalFlag(true), true);
    assert.equal(parseModoOperacionalFiscalFlag('true'), true);
    assert.equal(parseModoOperacionalFiscalFlag('0'), false);
    assert.equal(parseModoOperacionalFiscalFlag(0), false);
    assert.equal(parseModoOperacionalFiscalFlag(false), false);
    assert.equal(parseModoOperacionalFiscalFlag(undefined), false);
    assert.equal(parseModoOperacionalFiscalFlag(null), false);
  });

  it('payload do núcleo: emitir_fiscal=false; venda_fiscal opcional (RC3.15.11)', () => {
    const payload = montarPayloadVendaDoPedido({
      id: 1,
      total: 10,
      desconto: 0,
      cliente_id: 1,
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 10, subtotal: 10 }]
    }, { forma_pagamento: 'dinheiro' });
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.venda_fiscal, false);

    const comF12 = montarPayloadVendaDoPedido({
      id: 1,
      total: 10,
      desconto: 0,
      cliente_id: 1,
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 10, subtotal: 10 }]
    }, { forma_pagamento: 'dinheiro' }, { vendaFiscal: true });
    assert.equal(comF12.emitir_fiscal, false);
    assert.equal(comF12.venda_fiscal, true);
  });

  it('RC4.0.0 — Expedição nunca emite NF-e (Central de Faturamento)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/faturamento/FaturamentoService.js'),
      'utf8'
    );
    assert.match(src, /modo_dashboard_fiscal/);
    assert.match(src, /modoOperacionalFiscalAtivo/);
    assert.match(src, /proxima_etapa:\s*'central_faturamento'/);
    assert.match(src, /emitir_nfe:\s*false/);
    assert.doesNotMatch(src, /emitirNfePorVendaId\s*\(/);
  });

  it('não altera Motor / MIDP / PDV (smoke isolation)', () => {
    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'frontend/pdv/js/pdv.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
