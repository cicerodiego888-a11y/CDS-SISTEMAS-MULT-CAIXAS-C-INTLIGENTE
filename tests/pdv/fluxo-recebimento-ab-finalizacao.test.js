/**
 * Sprint — fluxo Recebimento A → B na finalização do PDV.
 * node --test tests/pdv/fluxo-recebimento-ab-finalizacao.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const PDV = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function carregarDecidir() {
  const m = PDV.match(/function decidirFluxoRecebimentosAB\([\s\S]*?\n\}/);
  assert.ok(m, 'decidirFluxoRecebimentosAB deve existir');
  return vm.runInNewContext(`${m[0]}; decidirFluxoRecebimentosAB`);
}

function ordemDe(f) {
  return JSON.parse(JSON.stringify(f.ordem));
}

function fiscal(a, b, total) {
  return decidir(a, b, { fluxoVendaFiscal: true, totalComercial: total != null ? total : a + b });
}

const decidir = carregarDecidir();
const FORMAS = ['pix', 'cartao_debito', 'debito', 'cartao_credito', 'credito'];

describe('Fluxo Recebimento A → B', () => {
  it('TESTE 1 — venda NÃO FISCAL com produto fiscal + não fiscal → somente B', () => {
    const f = decidir(60, 40, { fluxoVendaFiscal: false, totalComercial: 100 });
    assert.equal(f.abrirA, false);
    assert.equal(f.abrirB, true);
    assert.equal(f.valorA, 0);
    assert.equal(f.valorB, 100);
    assert.deepEqual(ordemDe(f), ['B']);
    assert.equal(f.somenteB, true);
  });

  it('TESTE 2 — fiscal somente A', () => {
    const f = fiscal(100, 0);
    assert.equal(f.abrirA, true);
    assert.equal(f.abrirB, false);
    assert.deepEqual(ordemDe(f), ['A']);
    assert.equal(f.somenteA, true);
  });

  it('TESTE 3 — fiscal A + B (PIX 100 → A 60 / B 40)', () => {
    const f = fiscal(60, 40, 100);
    assert.equal(f.valorA, 60);
    assert.equal(f.valorB, 40);
    assert.equal(f.abrirA, true);
    assert.equal(f.abrirB, true);
    assert.deepEqual(ordemDe(f), ['A', 'B']);
    assert.ok(f.ordem.indexOf('A') < f.ordem.indexOf('B'));
  });

  it('TESTE 4 — fiscal com transferência NF→F vira somente A', () => {
    const f = fiscal(5, 0);
    assert.equal(f.abrirA, true);
    assert.equal(f.abrirB, false);
    assert.deepEqual(ordemDe(f), ['A']);
  });

  it('TESTE 5 — fiscal sem transferência A+B', () => {
    const f = fiscal(3, 2);
    assert.equal(f.abrirA, true);
    assert.equal(f.abrirB, true);
    assert.deepEqual(ordemDe(f), ['A', 'B']);
  });

  it('fiscal somente B', () => {
    const f = fiscal(0, 100);
    assert.equal(f.abrirA, false);
    assert.equal(f.abrirB, true);
    assert.deepEqual(ordemDe(f), ['B']);
  });

  it('TESTE 6–8 — PIX / débito / crédito não mudam a quantidade de recebimentos', () => {
    const cenariosNf = [
      { a: 60, b: 40, total: 100, fiscal: false, ordem: ['B'] }
    ];
    const cenariosFiscal = [
      { a: 100, b: 0, ordem: ['A'] },
      { a: 0, b: 100, ordem: ['B'] },
      { a: 60, b: 40, ordem: ['A', 'B'] },
      { a: 5, b: 0, ordem: ['A'] },
      { a: 3, b: 2, ordem: ['A', 'B'] }
    ];
    for (const forma of FORMAS) {
      for (const c of cenariosNf) {
        const f = decidir(c.a, c.b, { fluxoVendaFiscal: false, totalComercial: c.total });
        assert.deepEqual(ordemDe(f), c.ordem, `${forma} NF A=${c.a} B=${c.b}`);
      }
      for (const c of cenariosFiscal) {
        const f = fiscal(c.a, c.b);
        assert.deepEqual(ordemDe(f), c.ordem, `${forma} FISCAL A=${c.a} B=${c.b}`);
      }
    }
  });

  it('executarFinalizacaoVenda usa fluxo da venda + composição A/B antes de gravar', () => {
    const fn = PDV.slice(PDV.indexOf('async function executarFinalizacaoVenda'));
    assert.match(fn, /decidirFluxoRecebimentosAB\(totalFiscal, totalNaoFiscal,/);
    assert.match(fn, /fluxoVendaFiscal: emitirFiscal === true/);
    assert.match(fn, /fluxo_venda = emitirFiscal === true \? 'fiscal' : 'nao_fiscal'/);
    assert.match(fn, /if \(fluxoAB\.abrirA\)/);
    assert.match(fn, /if \(fluxoAB\.abrirB\)/);
    assert.match(fn, /await confirmarRecebimentoB\(fluxoAB\.valorB\)/);
    assert.match(fn, /await processarVendaFiscalManual/);
    assert.doesNotMatch(fn, /confirmarRecebimentoBSeVendaMista/);
  });

  it('UI de pagamento usa Recebimento A/B e não Fiscal/Não Fiscal', () => {
    const a = PDV.slice(
      PDV.indexOf('function abrirModalConfirmacaoFiscalManual'),
      PDV.indexOf('async function obterModoConfirmacaoFiscal')
    );
    const b = PDV.slice(
      PDV.indexOf('function abrirModalPagamentoNaoFiscal'),
      PDV.indexOf('function abrirModalConfirmacaoFiscalManual')
    );
    assert.match(a, /Confirmação de Recebimento A/);
    assert.match(a, /Recebimento A/);
    assert.match(a, /Valor:/);
    assert.doesNotMatch(a, /Recebimento Fiscal/);
    assert.doesNotMatch(a, /Valor fiscal/);
    assert.match(b, /Recebimento B/);
    assert.match(b, /Valor:/);
    assert.doesNotMatch(b, /parcela não fiscal/i);
    assert.doesNotMatch(b, /Itens não fiscais/);
    assert.doesNotMatch(b, /Pagamento Fiscal/);
    assert.doesNotMatch(b, /Pagamento Não Fiscal/);
    assert.doesNotMatch(b, /PIX PF/);
  });

  it('cancelar A não chama B; B é depois de A no código', () => {
    const fn = PDV.slice(PDV.indexOf('async function executarFinalizacaoVenda'));
    const idxA = fn.indexOf('if (fluxoAB.abrirA)');
    const idxB = fn.indexOf('if (fluxoAB.abrirB)');
    assert.ok(idxA > 0 && idxB > idxA);
    assert.match(fn, /Recebimento A cancelado/);
    assert.match(PDV, /Recebimento B cancelado/);
  });

  it('não recorta o pagamento comercial só B antes da confirmação', () => {
    const fn = PDV.slice(PDV.indexOf('async function executarFinalizacaoVenda'));
    assert.doesNotMatch(
      fn.slice(0, fn.indexOf('decidirFluxoRecebimentosAB')),
      /tipo_recebimento: 'nao_fiscal'/
    );
  });
});
