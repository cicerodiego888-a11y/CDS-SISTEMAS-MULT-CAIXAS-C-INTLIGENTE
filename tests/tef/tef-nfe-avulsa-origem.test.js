'use strict';

/**
 * Sprint — Separar TEF da NF-e Avulsa (preserva NFC-e).
 * Executar: node --test tests/tef/tef-nfe-avulsa-origem.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const fluxo = require('../../backend/services/tef/tefFluxoPagamento');
const { montarPayloadVendaAvulsa } = require('../../backend/services/fiscal/nfeAvulsaService');

describe('NFC-e / PDV — regra TEF anterior preservada', () => {
  it('NFC-e + TEF ativo + PIX → exige TEF automático', () => {
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'TEF',
      tefHabilitado: true,
      formaPagamento: 'pix',
      ehPagamentoMisto: false,
      pagamentosMistos: [],
      totalFiscal: 50,
      origem: 'NFCE'
    });
    assert.equal(r.pagamentoExigeTef, true);
    assert.equal(r.deveUsarTefAutomatico, true);
  });

  it('PDV (sem origem) + TEF + PIX → mesmo comportamento legado', () => {
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'MANUAL',
      tefHabilitado: true,
      formaPagamento: 'pix',
      ehPagamentoMisto: false,
      pagamentosMistos: [],
      totalFiscal: 25
    });
    assert.equal(r.deveUsarTefAutomatico, true);
  });

  it('NFC-e + TEF ativo + cartão → exige TEF', () => {
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'TEF',
      tefHabilitado: true,
      formaPagamento: 'cartao_credito',
      ehPagamentoMisto: false,
      pagamentosMistos: [],
      totalFiscal: 80,
      origem: 'NFCE'
    });
    assert.equal(r.pagamentoExigeTef, true);
    assert.equal(r.deveUsarTefAutomatico, true);
  });
});

describe('NF-e Avulsa — TEF não herdado do PIX NFC-e', () => {
  it('NF-e Avulsa + PIX manual → NÃO exige TEF', () => {
    assert.equal(fluxo.formaPagamentoUsaTEF('pix', 'NF_AVULSA'), false);
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'TEF',
      tefHabilitado: true,
      formaPagamento: 'pix',
      ehPagamentoMisto: false,
      pagamentosMistos: [],
      totalFiscal: 100,
      origem: 'NF_AVULSA'
    });
    assert.equal(r.pagamentoExigeTef, false);
    assert.equal(r.deveUsarTefAutomatico, false);
  });

  it('NF-e Avulsa + dinheiro → NÃO exige TEF', () => {
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'TEF',
      tefHabilitado: true,
      formaPagamento: 'dinheiro',
      totalFiscal: 40,
      origem: 'NF_AVULSA'
    });
    assert.equal(r.pagamentoExigeTef, false);
    assert.equal(r.deveUsarTefAutomatico, false);
  });

  it('NF-e Avulsa + PIX integrado (pix_tef) → pode utilizar TEF', () => {
    assert.equal(fluxo.formaPagamentoUsaTEF('pix_tef', 'NF_AVULSA'), true);
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'MANUAL',
      tefHabilitado: true,
      formaPagamento: 'pix_tef',
      totalFiscal: 60,
      origem: 'NF_AVULSA'
    });
    assert.equal(r.pagamentoExigeTef, true);
    assert.equal(r.deveUsarTefAutomatico, true);
  });

  it('TEF desligado → NF-e Avulsa não exige TEF (mesmo pix_tef)', () => {
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'TEF',
      tefHabilitado: false,
      formaPagamento: 'pix_tef',
      totalFiscal: 60,
      origem: 'NF_AVULSA'
    });
    assert.equal(r.deveUsarTefAutomatico, false);
  });

  it('modo_confirmacao_fiscal TEF não força PIX manual na Avulsa', () => {
    const r = fluxo.resolverFluxoPagamentoFiscal({
      modoConfirmacaoFiscal: 'TEF',
      tefHabilitado: true,
      formaPagamento: 'pix',
      totalFiscal: 10,
      origem: 'NF_AVULSA'
    });
    assert.equal(r.deveUsarTefAutomatico, false);
    assert.equal(r.usarConfirmacaoManual, false);
  });
});

describe('Propagação origem NF_AVULSA + VendaPagamentoService', () => {
  it('montarPayloadVendaAvulsa propaga origem NF_AVULSA', () => {
    const p = montarPayloadVendaAvulsa({
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 10 }],
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: 10 }]
    });
    assert.equal(p.origem, 'NF_AVULSA');
  });

  it('VendaPagamentoService passa origem ao Orquestrador', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(src, /origem: origemDocumento/);
    assert.match(src, /vendaContext\?\.origem/);
    assert.match(src, /OrquestradorPagamento\.processarFluxoPagamentoVenda/);
  });

  it('Orquestrador considera origem na decisão TEF', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/OrquestradorPagamento.js'),
      'utf8'
    );
    assert.match(src, /origem/);
    assert.match(src, /ehOrigemNfeAvulsa|formaPagamentoUsaTEF\(.*origem/);
  });
});
