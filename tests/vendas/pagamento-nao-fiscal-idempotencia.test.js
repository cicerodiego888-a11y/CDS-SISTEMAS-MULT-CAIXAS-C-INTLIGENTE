/**
 * Idempotência do pagamento não fiscal + regras de saldo.
 * Executar: node --test tests/vendas/pagamento-nao-fiscal-idempotencia.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Svc = require('../../backend/services/vendas/VendaPagamentoService');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../backend/services/vendas/VendaPagamentoService.js'),
  'utf8'
);

describe('Pagamento não fiscal — saldo e idempotência', () => {
  it('TESTE 7 — saldo zero após recebimento completo', () => {
    const saldo = Svc.calcularSaldoNaoFiscal(
      { valor_nao_fiscal: 2 },
      [{ tipo_recebimento: 'nao_fiscal', valor: 2 }]
    );
    assert.equal(saldo.saldoPendente, 0);
    assert.equal(saldo.valorRecebido, 2);
  });

  it('saldo pendente quando incompleto', () => {
    const saldo = Svc.calcularSaldoNaoFiscal(
      { valor_nao_fiscal: 10 },
      [{ tipo_recebimento: 'nao_fiscal', valor: 8 }]
    );
    assert.equal(saldo.saldoPendente, 2);
  });

  it('mista quitada exige NF confirmado', () => {
    const aguarda = Svc.resolverStatusPagamentoVenda(2, [], 'quitada', { valorFiscal: 2 });
    assert.equal(aguarda, 'aguardando_nao_fiscal');

    const quitada = Svc.resolverStatusPagamentoVenda(
      2,
      [{ valor: 2 }],
      'quitada',
      { valorFiscal: 2 }
    );
    assert.equal(quitada, 'quitada');
  });

  it('registrarPagamentoNaoFiscal responde idempotente sem reinserir', () => {
    assert.match(SRC, /idempotente:\s*true/);
    assert.match(SRC, /Pagamento não fiscal já registrado/);
    assert.match(SRC, /Venda não fiscal já finalizada/);
    assert.match(SRC, /saldo\.saldoPendente <= 0/);
    assert.match(SRC, /Valor recebido maior que o saldo não fiscal pendente/);
  });

  it('não grava venda_pagamentos no fluxo não fiscal', () => {
    const start = SRC.indexOf('function registrarPagamentoNaoFiscal');
    assert.ok(start >= 0, 'função registrarPagamentoNaoFiscal');
    const trecho = SRC.slice(start, start + 12000);
    assert.doesNotMatch(trecho, /INSERT INTO venda_pagamentos/);
    assert.match(trecho, /gravarRecebimentos/);
  });
});
