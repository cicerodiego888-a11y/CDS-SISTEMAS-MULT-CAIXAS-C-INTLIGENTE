'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  produtoControlaEstoque,
  saldosParaDistribuicaoVenda,
  normalizarFlagControlaEstoque
} = require('../../backend/services/estoque/produtoControlaEstoque');
const {
  obterFaixaQuantidadeFiscal,
  distribuirQuantidadeVenda
} = require('../../backend/services/distribuidorEstoqueVenda');

test('RC8.0.Y: flag controla_estoque padrão é ON', () => {
  assert.equal(produtoControlaEstoque({}), true);
  assert.equal(produtoControlaEstoque({ controla_estoque: 1 }), true);
  assert.equal(produtoControlaEstoque({ controla_estoque: '1' }), true);
  assert.equal(normalizarFlagControlaEstoque(undefined), 1);
});

test('RC8.0.Y: controla_estoque=0 desliga controle', () => {
  assert.equal(produtoControlaEstoque({ controla_estoque: 0 }), false);
  assert.equal(produtoControlaEstoque({ controla_estoque: '0' }), false);
  assert.equal(normalizarFlagControlaEstoque(0), 0);
});

test('RC8.0.Y: saldos virtuais permitem venda sem estoque físico', () => {
  const saldos = saldosParaDistribuicaoVenda(
    { controla_estoque: 0 },
    2.5,
    0,
    0
  );
  assert.equal(saldos.saldoFiscal, 2.5);
  assert.equal(saldos.saldoNaoFiscal, 2.5);

  const faixa = obterFaixaQuantidadeFiscal(2.5, saldos.saldoFiscal, saldos.saldoNaoFiscal);
  assert.equal(faixa.sucesso, true);

  const distFiscal = distribuirQuantidadeVenda(2.5, saldos.saldoFiscal, saldos.saldoNaoFiscal, true);
  assert.equal(distFiscal.sucesso, true);
  assert.equal(distFiscal.quantidadeFiscal, 2.5);
  assert.equal(distFiscal.quantidadeNaoFiscal, 0);

  const distNf = distribuirQuantidadeVenda(2.5, saldos.saldoFiscal, saldos.saldoNaoFiscal, false);
  assert.equal(distNf.sucesso, true);
  assert.equal(distNf.quantidadeFiscal, 0);
  assert.equal(distNf.quantidadeNaoFiscal, 2.5);
});

test('RC8.0.Y: com controle ON ainda bloqueia saldo zero', () => {
  const saldos = saldosParaDistribuicaoVenda({ controla_estoque: 1 }, 1, 0, 0);
  assert.equal(saldos.saldoFiscal, 0);
  assert.equal(saldos.saldoNaoFiscal, 0);
  const faixa = obterFaixaQuantidadeFiscal(1, saldos.saldoFiscal, saldos.saldoNaoFiscal);
  assert.equal(faixa.sucesso, false);
});
