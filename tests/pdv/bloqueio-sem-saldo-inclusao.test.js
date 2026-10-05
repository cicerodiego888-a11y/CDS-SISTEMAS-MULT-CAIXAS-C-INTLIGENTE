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
    ${extract(pdv, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
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

function carregarFluxoInicializacaoPdv() {
  let inicializacoes = 0;
  let produtosDisponiveis = [];
  let resultadoInclusao = null;
  const controleResposta = { resolver: null };
  const $ = {
    ajax(opcoes) {
      opcoes.success([{
        id: 611,
        nome: 'Acém Bovino',
        categoria: 'Açougue',
        controla_estoque: 1,
        item_fiscal: 0,
        saldo_fiscal: 0,
        saldo_nao_fiscal: 0,
        reservado_fiscal: 0,
        reservado_nao_fiscal: 0
      }]);
      return {};
    }
  };
  const fetch = () => new Promise((resolve) => {
    controleResposta.resolver = resolve;
  });
  const factory = new Function('$', 'fetch', 'localStorage', 'API_URL', 'window', 'controleResposta', `
    let pdvFlagVendaSemEstoque = false;
    let produtosDisponiveis = [];
    const produtoTeste = {
      id: 611,
      nome: 'Acém Bovino',
      categoria: 'Açougue',
      controla_estoque: 1,
      item_fiscal: 0,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0,
      reservado_fiscal: 0,
      reservado_nao_fiscal: 0
    };
    function pdvPermitirVendaSemEstoque() { return pdvFlagVendaSemEstoque === true; }
    function pdvModoFiscalAtivo() { return false; }
    function urlProdutosPdv() { return '/produtos'; }
    function autoRegistrarTerminal() {}
    function inicializarSincronizacaoCatalogoPdv() {}
    function carregarFlagTransferenciaNaoFiscalFiscalPdv() {}
    function carregarFlagEditarPrecoUnitarioPdv() {}
    function carregarFlagExigirNcmCadastroPdv() {}
    function carregarFlagImprimirCupomPdv() {}
    function carregarFlagComposicaoItensPdv() {}
    function definirCatalogoPdv(produtos) { produtosDisponiveis = produtos; }
    let inicializacoes = 0;
    let produtoIncluido = null;
    function inicializarPDV() {
      inicializacoes += 1;
      adicionarProdutoConsultaPDV(produtoTeste.id);
    }
    ${extract(pdv, 'function carregarFlagVendaSemEstoquePdv', 'function carregarFlagExigirNcmCadastroPdv')}
    ${extract(pdv, 'function pdvResolverSaldosProduto', 'function round3TransferenciaPdv')}
    ${extract(pdv, 'function pdvSaldosDisponiveisMotorProduto', 'function pdvProdutoSemSaldoControlado')}
    ${extract(pdv, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    ${extract(pdv, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
    ${extract(pdv, 'function validarEstoqueVenda', 'function pdvNotificarBloqueioInclusaoProduto')}
    function garantirProdutoNoCatalogoPdv(id) { return Promise.resolve(Number(id) === produtoTeste.id ? produtoTeste : null); }
    function buscarPromocaoAtivaProduto() { return Promise.resolve(null); }
    function iniciarFluxoAdicionarProdutoPdv(produto) { produtoIncluido = produto; }
    function showNotification() {}
    ${extract(pdv, 'function adicionarProdutoConsultaPDV', 'function buscarProdutosConsultaPDV')}
    ${extract(pdv, 'function loadPDV', '/**\n * Sprint 09 — flag global não controla mais o PDV')}
    return {
      loadPDV,
      inicializacoes: () => inicializacoes,
      produtoIncluido: () => produtoIncluido,
      resolverRespostaFlag: (valor) => controleResposta.resolver(valor)
    };
  `);
  return factory($, fetch, { getItem: () => 'token' }, '/api', {}, controleResposta);
}

describe('PDV — bloqueio de inclusão sem saldo F+NF', () => {
  it('aguarda a configuração VENDA SEM ESTOQUE antes de inicializar o fluxo de inclusão', async () => {
    const fluxo = carregarFluxoInicializacaoPdv();
    fluxo.loadPDV();

    assert.equal(fluxo.inicializacoes(), 0, 'não deve liberar inclusão antes da resposta da configuração');

    fluxo.resolverRespostaFlag({
      ok: true,
      json: async () => ({ permitido: true })
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fluxo.inicializacoes(), 1, 'deve inicializar depois de carregar a flag ativa');
    assert.equal(fluxo.produtoIncluido()?.nome, 'Acém Bovino', 'Acém Bovino elegível deve alcançar o fluxo de inclusão');
  });

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

  it('flag venda sem estoque ATIVADA permite inclusão com F e NF zerados', () => {
    const api = carregarRegras();
    api.setFlag(true);
    const produto = {
      nome: 'Farinha',
      categoria: 'Açougue',
      controla_estoque: 1,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0
    };
    const inicio = api.pdvPodeIniciarInclusaoProduto(produto);
    assert.equal(inicio.sucesso, true);
    const validacao = api.validarEstoqueVenda(produto, 2);
    assert.equal(validacao.sucesso, false);
    assert.equal(validacao.confirmarSemEstoque, true);
    assert.equal(validacao.semSaldoTotal, undefined);
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
      categoria: 'Açougue',
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

  it('flag ON permite saldo insuficiente somente para Açougue e Hortifruti', () => {
    const api = carregarRegras();

    api.setFlag(false);
    for (const categoria of ['Açougue', 'Hortifruti']) {
      const produto = {
        nome: 'Produto sem estoque',
        categoria,
        controla_estoque: 1,
        saldo_fiscal: 0,
        saldo_nao_fiscal: 0
      };
      const bloqueio = api.pdvPodeIniciarInclusaoProduto(produto);
      assert.equal(bloqueio.sucesso, false, `${categoria}: flag OFF deve bloquear`);
      assert.equal(bloqueio.semSaldoTotal, true, `${categoria}: bloqueio por saldo zerado`);
    }

    api.setFlag(true);

    for (const categoria of ['Açougue', 'Hortifruti']) {
      const produto = {
        nome: 'Produto elegível',
        categoria,
        controla_estoque: 1,
        saldo_fiscal: 0,
        saldo_nao_fiscal: 0
      };
      assert.equal(api.pdvPodeIniciarInclusaoProduto(produto).sucesso, true, categoria);
      assert.equal(api.validarEstoqueVenda(produto, 1).confirmarSemEstoque, true, categoria);
    }

    for (const categoria of ['Mercearia', 'Bebidas', 'Limpeza', '']) {
      const produto = {
        nome: 'Produto inelegível',
        categoria,
        controla_estoque: 1,
        saldo_fiscal: 0,
        saldo_nao_fiscal: 0
      };
      const inicio = api.pdvPodeIniciarInclusaoProduto(produto);
      assert.equal(inicio.sucesso, false, categoria || 'sem categoria');
      assert.equal(inicio.semSaldoTotal, true, categoria || 'sem categoria');
      assert.equal(api.validarEstoqueVenda(produto, 1).confirmarSemEstoque, undefined, categoria);
    }
  });

  it('flag ON não oferece confirmação a Mercearia com saldo parcial insuficiente', () => {
    const api = carregarRegras();
    api.setFlag(true);
    const produto = {
      nome: 'Arroz',
      categoria: 'Mercearia',
      controla_estoque: 1,
      saldo_fiscal: 1,
      saldo_nao_fiscal: 0
    };

    const validacao = api.validarEstoqueVenda(produto, 2);
    assert.equal(validacao.sucesso, false);
    assert.equal(validacao.confirmarSemEstoque, undefined);
  });

  it('MIP, etiqueta, legado e F1 avisam na inclusão', () => {
    assert.match(pdv, /function pdvProdutoSemSaldoControlado/);
    assert.match(pdv, /function pdvMensagemProdutoSemSaldo/);
    assert.match(pdv, /semSaldoTotal:\s*true/);
    assert.match(pdv, /Não é possível inserir na venda/);

    const validar = extract(pdv, 'function validarEstoqueVenda', 'function pdvValidarEstoqueVenda');
    assert.match(validar, /saldoFiscal <= 1e-9 && saldoNaoFiscal <= 1e-9/);
    assert.match(validar, /pdvVendaSemEstoquePermitida\(produto\)/);
    assert.match(pdv, /return pdvPermitirVendaSemEstoque\(\) && pdvCategoriaElegivelVendaSemEstoque\(produto\)/);

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
