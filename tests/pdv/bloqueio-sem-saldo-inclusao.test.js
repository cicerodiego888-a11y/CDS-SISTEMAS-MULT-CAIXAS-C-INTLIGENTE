/**
 * PDV — produto com controla_estoque e F=0 + NF=0 não entra na venda.
 * Aviso acontece na inclusão, não só na finalização.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Trecho não encontrado: ${startMarker} → ${endMarker}`);
  }
  return src.slice(start, end);
}

function carregarRegras() {
  const factory = new Function(`
    function pdvResolverSaldosProduto(produto) {
      const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
      const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
      return {
        saldo_fiscal: saldoFiscal,
        saldo_nao_fiscal: saldoNaoFiscal,
        estoque_atual: saldoFiscal + saldoNaoFiscal
      };
    }
    let flagVendaSemEstoque = false;
    function pdvPermitirVendaSemEstoque() { return flagVendaSemEstoque === true; }
    function pdvModoFiscalAtivo() { return false; }
    ${extract(pdv, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    ${extract(pdv, 'function validarEstoqueVenda', 'function pdvNotificarBloqueioInclusaoProduto')}
    return {
      setFlag(v) { flagVendaSemEstoque = v === true; },
      pdvProdutoSemSaldoControlado,
      pdvMensagemProdutoSemSaldo,
      validarEstoqueVenda,
      pdvPodeIniciarInclusaoProduto
    };
  `);
  return factory();
}

describe('PDV — bloqueio de inclusão sem saldo F+NF', () => {
  it('F=0 NF=0 e controla estoque bloqueia antes de inserir', () => {
    const api = carregarRegras();
    const produto = {
      id: 10,
      nome: 'Açúcar Cristal 1kg',
      controla_estoque: 1,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0
    };

    assert.equal(api.pdvProdutoSemSaldoControlado(produto), true);
    const inicio = api.pdvPodeIniciarInclusaoProduto(produto);
    assert.equal(inicio.sucesso, false);
    assert.equal(inicio.semSaldoTotal, true);
    assert.match(inicio.mensagem, /Açúcar Cristal 1kg não tem saldo/);
    assert.match(inicio.mensagem, /Não é possível inserir na venda/);

    const validacao = api.validarEstoqueVenda(produto, 1);
    assert.equal(validacao.sucesso, false);
    assert.equal(validacao.semSaldoTotal, true);
    assert.equal(validacao.confirmarSemEstoque, undefined);
  });

  it('flag venda sem estoque NÃO abre confirmação quando F e NF estão zerados', () => {
    const api = carregarRegras();
    api.setFlag(true);
    const produto = {
      nome: 'Farinha',
      controla_estoque: 1,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0
    };
    const inicio = api.pdvPodeIniciarInclusaoProduto(produto);
    assert.equal(inicio.sucesso, false);
    assert.equal(inicio.semSaldoTotal, true);
    const validacao = api.validarEstoqueVenda(produto, 2);
    assert.equal(validacao.confirmarSemEstoque, undefined);
    assert.equal(validacao.semSaldoTotal, true);
  });

  it('só NF > 0 continua podendo iniciar inclusão (F12 não bloqueia)', () => {
    const api = carregarRegras();
    const produto = {
      nome: 'Refrigerante',
      controla_estoque: 1,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 8
    };
    assert.equal(api.pdvProdutoSemSaldoControlado(produto), false);
    const inicio = api.pdvPodeIniciarInclusaoProduto(produto);
    assert.equal(inicio.sucesso, true);
    const validacao = api.validarEstoqueVenda(produto, 3);
    assert.equal(validacao.sucesso, true);
  });

  it('controla_estoque=0 permite inserir mesmo sem saldo', () => {
    const api = carregarRegras();
    const produto = {
      nome: 'Serviço',
      controla_estoque: 0,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0
    };
    assert.equal(api.pdvProdutoSemSaldoControlado(produto), false);
    assert.equal(api.pdvPodeIniciarInclusaoProduto(produto).sucesso, true);
    assert.equal(api.validarEstoqueVenda(produto, 1).sucesso, true);
  });

  it('saldo parcial insuficiente ainda pode pedir confirmação se a flag estiver ligada', () => {
    const api = carregarRegras();
    api.setFlag(true);
    const produto = {
      nome: 'Arroz',
      controla_estoque: 1,
      saldo_fiscal: 2,
      saldo_nao_fiscal: 0
    };
    assert.equal(api.pdvPodeIniciarInclusaoProduto(produto).sucesso, true);
    const validacao = api.validarEstoqueVenda(produto, 5);
    assert.equal(validacao.sucesso, false);
    assert.equal(validacao.confirmarSemEstoque, true);
    assert.equal(validacao.semSaldoTotal, undefined);
  });

  it('MIP, etiqueta, legado e F1 avisam na inclusão', () => {
    assert.match(pdv, /function pdvProdutoSemSaldoControlado/);
    assert.match(pdv, /function pdvMensagemProdutoSemSaldo/);
    assert.match(pdv, /semSaldoTotal:\s*true/);
    assert.match(pdv, /Não é possível inserir na venda/);

    const validar = extract(pdv, 'function validarEstoqueVenda', 'function pdvValidarEstoqueVenda');
    assert.match(validar, /saldoFiscal <= 1e-9 && saldoNaoFiscal <= 1e-9/);
    assert.doesNotMatch(validar, /semSaldoTotal[\s\S]{0,80}confirmarSemEstoque/);

    const legado = extract(
      pdv,
      'function adicionarProdutoPorCodigoLegado',
      'async function adicionarProdutoPorCodigoViaMip'
    );
    assert.match(legado, /garantirProdutoNoCatalogoPdv/);
    assert.match(legado, /pdvPodeIniciarInclusaoProduto\(produto\)/);

    const mip = extract(
      pdv,
      'async function adicionarProdutoPorCodigoViaMip',
      'function atualizarQuantidade'
    );
    assert.match(mip, /validacaoEtiqueta = pdvPodeIniciarInclusaoProduto\(produtoCarrinho\)/);
    assert.match(mip, /pdvPodeIniciarInclusaoProduto\(produtoCarrinho\)/);

    const f1 = extract(pdv, 'function adicionarProdutoConsultaPDV', 'function buscarProdutosConsultaPDV');
    assert.match(f1, /forcarAtualizacao:\s*true/);
    assert.match(f1, /pdvPodeIniciarInclusaoProduto\(produto\)/);
    assert.match(f1, /semSaldoTotal \? 'danger'/);

    assert.match(pdv, /if \(validacaoEstoque\.semSaldoTotal\)/);
    assert.match(pdv, /confirmarSemEstoque && !validacaoEstoque\.semSaldoTotal/);
  });
});
