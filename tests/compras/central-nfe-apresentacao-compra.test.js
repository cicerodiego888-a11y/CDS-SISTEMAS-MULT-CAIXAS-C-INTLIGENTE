'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { mapearInfNFe } = require('../../backend/shared/nfe/mappers/nfeXmlMapper');
const { obterMuc } = require('../../backend/motores/muc');

const root = path.join(__dirname, '../..');
const comprasSource = fs.readFileSync(
  path.join(root, 'frontend/erp/js/compras.js'),
  'utf8'
);
const comprasHelperStart = comprasSource.indexOf('function normalizarUnidadeApresentacaoCentralCompra');
const comprasHelperEnd = comprasSource.indexOf('function prepararItemQuantidadesImportacaoCentral', comprasHelperStart);
const comprasHelpers = comprasSource.slice(comprasHelperStart, comprasHelperEnd);
const workflowStart = comprasSource.indexOf('async function preencherFormularioCompra');

function extrairFuncao(nome) {
  const start = comprasSource.indexOf(`function ${nome}(`);
  assert.notEqual(start, -1, `função ${nome} deve existir`);
  const end = comprasSource.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `fim da função ${nome} deve existir`);
  return comprasSource.slice(start, end + 3);
}

function criarResolvers() {
  const browser = {};
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8'),
    { window: browser, console }
  );
  return browser.ProdutoApresentacaoResolver;
}

function criarItemNfe(quantidade, fator, precoFardo, unidadeComercial = 'FARDO') {
  return mapearInfNFe({
    ide: {},
    emit: {},
    det: [{
      prod: {
        xProd: 'Produto em fardo',
        cProd: 'FARDO-10',
        uCom: unidadeComercial,
        qCom: String(quantidade),
        vUnCom: String(precoFardo),
        vProd: String(quantidade * precoFardo),
        uTrib: 'UN',
        qTrib: String(quantidade * fator),
        vUnTrib: String(precoFardo / fator)
      },
      imposto: {}
    }],
    total: { ICMSTot: { vProd: String(quantidade * precoFardo) } }
  }).itens[0].toJSON();
}

async function prepararItemCentral(quantidade, fator, precoFardo, opcoes = {}) {
  const produtoId = 9182;
  const unidadeComercial = opcoes.unidadeComercial || 'FARDO';
  const unidadeEstoque = opcoes.unidadeEstoque || 'UN';
  const unidadeTributavel = opcoes.unidadeTributavel ?? unidadeEstoque;
  const tipoApresentacao = opcoes.tipoApresentacao || 'FD';
  const quantidadeTributavel = opcoes.quantidadeTributavel ?? quantidade * fator;
  const qTrib = opcoes.qTrib ?? quantidadeTributavel;
  const produtos = [{ id: produtoId, nome: 'Produto em fardo', unidade: unidadeEstoque }];
  const apresentacao = {
    id: 772,
    produto_id: produtoId,
    tipo: tipoApresentacao,
    quantidade: fator,
    unidade: unidadeEstoque,
    principal: 1,
    compra: 1,
    venda: 1,
    estoque: 1,
    ativa: 1
  };
  const fetches = [];
  const context = {
    API_URL: '/api',
    produtosCompraList: produtos,
    ProdutoApresentacaoResolver: criarResolvers(),
    localStorage: { getItem: () => 'test-token' },
    fetch: async (url, options) => {
      fetches.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          id: produtoId,
          nome: 'Produto em fardo',
          unidade: unidadeEstoque,
          embalagens: [apresentacao]
        })
      };
    },
    $: () => ({ append: () => {} }),
    escapeHtml: (value) => String(value)
  };
  vm.runInNewContext([
    extrairFuncao('resolverCustoUnitarioCentralNfe'),
    comprasHelpers
  ].join('\n'), context);

  const item = {
    ...criarItemNfe(quantidade, fator, precoFardo, unidadeComercial),
    produto_id: produtoId,
    quantidade_tributavel: quantidadeTributavel,
    qTrib,
    unidade_tributavel: unidadeTributavel,
    uTrib: unidadeTributavel,
    ...(opcoes.precoTributavel !== undefined ? { preco_unitario_trib: opcoes.precoTributavel } : {})
  };
  await context.enriquecerApresentacoesItensCentralCompra([item]);
  return { item, produto: produtos[0], fetches };
}

async function executarFluxoMargemCentral({
  incluirPrecoTributavel = true,
  unidadeComercial = 'FD',
  xml = {}
} = {}) {
  const produtoId = 9182;
  const fator = 10;
  const quantidade = 100;
  const precoApresentacao = 43.9;
  const itemNfe = criarItemNfe(quantidade, fator, precoApresentacao, unidadeComercial);
  itemNfe.produto_nome = 'ARROZ POP PARB T2 1KG';
  itemNfe.preco_unitario = precoApresentacao;
  itemNfe.subtotal = 4390;
  itemNfe.produto_id = produtoId;
  delete itemNfe.custo_unitario_final;
  delete itemNfe.custo_unitario;
  delete itemNfe.custo_por_kg;
  if (!incluirPrecoTributavel) {
    delete itemNfe.preco_unitario_trib;
    delete itemNfe.preco_unitario_tributavel;
  }
  Object.assign(itemNfe, xml);

  const produto = {
    id: produtoId,
    nome: itemNfe.produto_nome,
    unidade: 'UN',
    preco_compra: 4.38,
    preco_venda: 5.92,
    embalagens: [{
      id: 772,
      produto_id: produtoId,
      tipo: 'FD',
      quantidade: fator,
      unidade: 'UN',
      principal: 1,
      compra: 1,
      venda: 1,
      estoque: 1,
      ativa: 1
    }]
  };
  const coreStart = comprasSource.indexOf('function normalizarUnidadeApresentacaoCentralCompra');
  const coreEnd = comprasSource.indexOf('function recalcularLinhaCompra', coreStart);
  const core = comprasSource.slice(coreStart, coreEnd);
  const source = [
    comprasSource.slice(
      comprasSource.indexOf('function normalizarPrecoVendaCentral'),
      comprasSource.indexOf('/**\n * CORREÇÃO-NF-MARGEM-01', comprasSource.indexOf('function normalizarPrecoVendaCentral'))
    ),
    core,
    extrairFuncao('calcularDistribuicaoFiscalMotorItem'),
    extrairFuncao('aplicarDistribuicaoFiscalItemCentral'),
    extrairFuncao('aplicarDistribuicaoFiscalItensCentral'),
    extrairFuncao('resolverCustoUnitarioItemCompra'),
    extrairFuncao('resolverSnapshotEmbalagemEdicaoCentral'),
    extrairFuncao('renderAlertaVariacaoCustoEntradaCentral'),
    extrairFuncao('resolverVariacaoCustoEntradaCentral'),
    extrairFuncao('formatarPrecoCompraItem'),
    extrairFuncao('sincronizarPrecosCadastroItemCompra'),
    extrairFuncao('sincronizarQuantidadesEstoqueItemCompra'),
    extrairFuncao('renderItensCompraTabelaCore'),
    extrairFuncao('iniciarDraftCompraEdicao')
  ].join('\n');
  const browser = { ProdutoApresentacaoResolver: criarResolvers() };
  let htmlTabela = '';
  const context = {
    window: browser,
    ProdutoApresentacaoResolver: browser.ProdutoApresentacaoResolver,
    console,
    API_URL: '/api',
    ORIGEM_COMPRA: { CENTRAL_NFE: 'CENTRAL_NFE' },
    TIPOS_ENTRADA_COMPRA: { REVENDA: 'REVENDA' },
    tipoEntradaCompraAtual: 'REVENDA',
    produtosCompraList: [produto],
    fetch: async () => ({ ok: true, json: async () => produto }),
    localStorage: { getItem: () => 'token-teste' },
    itensCompraAtual: [],
    indiceEditandoCompra: null,
    indiceProximoDestaqueCompra: null,
    itemDraftCompra: null,
    linhaIdEditandoCompra: null,
    isOrigemCompraCentralNfe: () => true,
    itemCompraEhFracionado: () => false,
    clonarDadosItemCompra: (item) => JSON.parse(JSON.stringify(item)),
    clonarNestedMiipItemCompra: (item) => item ? JSON.parse(JSON.stringify(item)) : null,
    obterQuantidadeComercialItemCompra: (item) => Number(item.quantidade_comercial ?? item.qCom ?? item.quantidade ?? 0),
    obterQuantidadeConvertidaItemCompra: (item) => Number(item.quantidade_convertida ?? item.quantidade_tributavel ?? item.qTrib ?? item.quantidade ?? 0),
    calcularSubtotalFinanceiroItemCompra: (item) => Number((Number(item.quantidade || 0) * Number(item.preco_unitario || 0)).toFixed(2)),
    enriquecerItemFiscalCompraUi: (item) => item,
    resolverProdutoRefItemCompra: (item) => produto.id === Number(item.produto_id) ? produto : null,
    aplicarPoliticaPrecoVendaCentral: () => {},
    persistirPrecoUnitarioComercialItemCompra: (item) => Number(item.preco_unitario_comercial || item.preco_unitario || 0),
    gerarLinhaIdCompra: () => 'linha-teste-central',
    obterLinhaIdItemCompra: (item) => item?.linha_id || item?.linhaId || null,
    formatQuantidadeExibicao: (value) => String(value),
    formatarQuantidadeExibicao: (value) => String(value),
    formatarCustoUnitarioVenda: (value) => Number(value).toFixed(4),
    rotuloTipoEmbalagemCompra: (value) => String(value),
    formatCurrency: (value) => `R$ ${Number(value).toFixed(2)}`,
    formatNumberInput: (value) => Number(value).toFixed(2),
    escapeHtml: (value) => String(value || ''),
    renderMiipSugestaoCard: () => '',
    renderCfopColunaItemCompra: () => '',
    formatarQuantidadeItemCompra: () => '',
    renderResumoConversaoItemCompraHtml: () => '',
    recalcularTotaisCompraNota: () => {},
    $: () => ({ html: (html) => { htmlTabela = html; } })
  };
  vm.runInNewContext(source, context);

  const itemBruto = { ...itemNfe };
  await context.enriquecerApresentacoesItensCentralCompra([itemBruto]);
  const antesNormalize = JSON.parse(JSON.stringify(itemBruto));
  const normalizado = context.normalizeItemCompra(
    context.enriquecerItemFiscalCompraUi(context.clonarDadosItemCompra(itemBruto))
  );
  const depoisNormalize = JSON.parse(JSON.stringify(normalizado));
  const depoisDistribuicao = context.aplicarDistribuicaoFiscalItensCentral([normalizado], 'REVENDA')[0];
  context.itensCompraAtual = [depoisDistribuicao];
  const imediatamenteAntesRender = JSON.parse(JSON.stringify(context.itensCompraAtual[0]));
  const subtotalAntesRender = context.itensCompraAtual[0].subtotal;
  context.renderItensCompraTabelaCore();
  const htmlAntesEditar = htmlTabela;
  const margemAntesEditar = htmlAntesEditar.match(/data-margem-bruta-item="0">([^<]+)/)?.[1];
  const custoNaMargem = context.resolverCustoUnitarioCentralNfe(context.itensCompraAtual[0]);

  const draftDepoisEditar = context.iniciarDraftCompraEdicao(0);
  context.renderItensCompraTabelaCore();
  const htmlDepoisEditar = htmlTabela;
  const margemDepoisEditar = htmlTabela.match(/data-margem-bruta-item="0">([^<]+)/)?.[1];
  const subtotalDepoisEditar = context.itensCompraAtual[0].subtotal;
  const snapshotsCiclo = [];
  let linhaCiclo = context.itensCompraAtual[0];
  for (const precoVenda of [5.92, 6, 7]) {
    const draftEdicao = context.iniciarDraftCompraEdicao(0);
    const snapshotEmbalagem = context.resolverSnapshotEmbalagemEdicaoCentral(
      draftEdicao,
      draftEdicao.quantidade_embalagens,
      draftEdicao.preco_unitario_comercial
    );
    assert.ok(snapshotEmbalagem, JSON.stringify(draftEdicao));
    const qtdTotal = snapshotEmbalagem.qtdTotal;
    const custoUnitario = snapshotEmbalagem.custoUnitario;
    linhaCiclo = context.normalizeItemCompra({
      linha_id: draftEdicao.linha_id,
      produto_id: draftEdicao.produto_id,
      produto_nome: draftEdicao.produto_nome,
      codigo_barras: draftEdicao.codigo_barras,
      unidade: draftEdicao.unidade,
      unidade_comercial: draftEdicao.unidade_comercial,
      quantidade: qtdTotal,
      quantidade_fiscal: qtdTotal,
      quantidade_nao_fiscal: 0,
      quantidade_convertida: qtdTotal,
      preco_unitario: custoUnitario,
      custo_unitario_final: custoUnitario,
      custo_unitario: custoUnitario,
      precoVendaOriginal: 5.92,
      precoVendaAtual: precoVenda,
      precoVendaAlteradoManualmente: precoVenda !== 5.92,
      quantidade_comercial: draftEdicao.quantidade_comercial,
      quantidade_embalagens: draftEdicao.quantidade_embalagens,
      quantidade_por_embalagem: draftEdicao.quantidade_por_embalagem,
      fator_conversao: draftEdicao.fator_conversao,
      valor_total_embalagem: snapshotEmbalagem.valorTotal,
      preco_unitario_comercial: draftEdicao.preco_unitario_comercial,
      preco_apresentacao: draftEdicao.preco_apresentacao,
      embalagem_id: draftEdicao.embalagem_id,
      produto_apresentacao_id: draftEdicao.produto_apresentacao_id,
      compra_em: draftEdicao.compra_em,
      tipo_origem_compra: draftEdicao.tipo_origem_compra,
      origem_conversao: draftEdicao.origem_conversao,
      subtotal: snapshotEmbalagem.valorTotal,
      origem_compra: 'CENTRAL_NFE'
    });
    context.itensCompraAtual[0] = linhaCiclo;
    snapshotsCiclo.push({
      etapa: `salvo-${precoVenda}`,
      item: JSON.parse(JSON.stringify(linhaCiclo))
    });
    const reaberto = context.iniciarDraftCompraEdicao(0);
    snapshotsCiclo.push({
      etapa: `reaberto-${precoVenda}`,
      item: JSON.parse(JSON.stringify(reaberto))
    });
  }

  return {
    antesNormalize,
    depoisNormalize,
    depoisDistribuicao: JSON.parse(JSON.stringify(depoisDistribuicao)),
    imediatamenteAntesRender,
    custoNaMargem,
    draftDepoisEditar: JSON.parse(JSON.stringify(draftDepoisEditar)),
    margemAntesEditar,
    margemDepoisEditar,
    htmlAntesEditar,
    htmlDepoisEditar,
    subtotalAntesRender,
    subtotalDepoisEditar,
    snapshotsCiclo
  };
}

for (const quantidade of [1, 2]) {
  test(`Central NF-e associa ${quantidade} FARDO(s) e converte pelo MUC`, async () => {
    const fator = 10;
    const precoFardo = 43.8;
    const { item, produto, fetches } = await prepararItemCentral(quantidade, fator, precoFardo);

    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].url, `/api/produtos/${produto.id}`);
    assert.equal(item.quantidade_comercial, quantidade);
    assert.equal(item.quantidade_embalagens, quantidade);
    assert.equal(item.quantidade_por_embalagem, fator);
    assert.equal(item.quantidade_convertida, quantidade * fator);
    assert.equal(item.quantidade_estoque, quantidade * fator);
    assert.equal(item.unidade_estoque, 'UN');
    assert.equal(item.unidade, 'UN');
    assert.equal(item.embalagem_id, 772);
    assert.equal(item.produto_apresentacao_id, 772);
    assert.equal(item.compra_em, 'FD');
    assert.equal(item.preco_unitario_comercial, precoFardo);
    assert.equal(item.valor_total_embalagem, quantidade * precoFardo);
    assert.equal(item.quantidade_tributavel, quantidade * fator);
    assert.equal(produto.central_nfe_usa_apresentacao_compra, true);

    const resultado = obterMuc(null).converter({
      produtoId: produto.id,
      produto,
      item: {
        ...item,
        unidade: 'UN',
        tipo_origem_compra: 'EMBALAGEM_COMERCIAL'
      },
      quantidadeCompra: quantidade,
      unidadeCompra: 'FD',
      quantidadePorApresentacao: fator,
      valorTotalCompra: quantidade * precoFardo,
      unidadeEstoque: 'UN',
      origem: 'CENTRAL_NFE'
    });

    assert.equal(resultado.quantidadeEstoque, quantidade * fator);
    assert.equal(resultado.custoUnitario, 4.38);
    assert.equal(resultado.custoTotal, quantidade * precoFardo);
  });
}

test('fluxo real de importação Central preserva custo unitário e margem antes/depois de Editar', async () => {
  for (const incluirPrecoTributavel of [true, false]) {
    const resultado = await executarFluxoMargemCentral({ incluirPrecoTributavel });

    assert.equal(resultado.antesNormalize.preco_unitario, 4.39);
    assert.equal(resultado.antesNormalize.preco_unitario_comercial, 43.9);
    assert.equal(resultado.antesNormalize.preco_apresentacao, 43.9);
    assert.equal(resultado.antesNormalize.custo_unitario, 4.39);
    assert.equal(resultado.antesNormalize.custo_unitario_final, 4.39);
    assert.equal(resultado.antesNormalize.quantidade_comercial, 100);
    assert.equal(resultado.antesNormalize.quantidade_tributavel, 1000);
    assert.equal(resultado.antesNormalize.valor_total_embalagem, 4390);
    assert.equal(resultado.antesNormalize.preco_unitario_trib || 0, incluirPrecoTributavel ? 4.39 : 0);
    assert.equal(resultado.depoisNormalize.preco_apresentacao, 43.9);
    assert.equal(resultado.depoisNormalize.preco_unitario_comercial, 43.9);
    assert.equal(resultado.depoisNormalize.valor_total_embalagem, 4390);
    assert.equal(resultado.depoisNormalize.quantidade_comercial, 100);
    assert.equal(resultado.depoisNormalize.quantidade_convertida, 1000);
    assert.equal(resultado.depoisNormalize.quantidade_estoque, 1000);
    assert.equal(resultado.depoisNormalize.preco_unitario, 4.39);
    assert.equal(resultado.depoisNormalize.custo_unitario, 4.39);
    assert.equal(resultado.depoisNormalize.custo_unitario_final, 4.39);
    assert.equal(resultado.depoisDistribuicao.preco_unitario, 4.39);
    assert.equal(resultado.depoisDistribuicao.custo_unitario_final, 4.39);
    assert.equal(resultado.imediatamenteAntesRender.custo_unitario_final, 4.39);
    assert.equal(resultado.imediatamenteAntesRender.preco_apresentacao, 43.9);
    assert.equal(resultado.imediatamenteAntesRender.preco_unitario_comercial, 43.9);
    assert.equal(resultado.imediatamenteAntesRender.custo_unitario_final, 4.39);
    assert.equal(resultado.custoNaMargem, 4.39);
    assert.equal(resultado.subtotalAntesRender, 4390);
    assert.equal(resultado.subtotalDepoisEditar, 4390);
    assert.equal(resultado.draftDepoisEditar.custo_unitario_final, 4.39);
    assert.equal(resultado.draftDepoisEditar.quantidade_estoque, 1000);
    assert.equal(resultado.draftDepoisEditar.quantidade_convertida, 1000);
    assert.equal(resultado.margemAntesEditar, '25.84%');
    assert.equal(resultado.margemDepoisEditar, '25.84%');
    assert.deepEqual(
      resultado.snapshotsCiclo.map(({ etapa }) => etapa),
      ['salvo-5.92', 'reaberto-5.92', 'salvo-6', 'reaberto-6', 'salvo-7', 'reaberto-7']
    );
    for (const { etapa, item } of resultado.snapshotsCiclo) {
      assert.equal(item.quantidade_comercial, 100, `${etapa}: comercial`);
      assert.equal(item.quantidade_estoque, 1000, `${etapa}: quantidade estoque`);
      assert.equal(item.quantidade_convertida, 1000, `${etapa}: quantidade convertida`);
      assert.equal(item.quantidade_por_embalagem, 10, `${etapa}: fator`);
      assert.equal(item.preco_apresentacao, 43.9, `${etapa}: preço da apresentação`);
      assert.equal(item.preco_unitario_comercial, 43.9, `${etapa}: preço comercial`);
      assert.equal(item.custo_unitario_final, 4.39, `${etapa}: custo`);
      assert.equal(item.preco_unitario, 4.39, `${etapa}: preço unitário do estoque`);
      assert.equal(item.subtotal, 4390, `${etapa}: subtotal`);
      assert.equal(item.precoVendaAtual, etapa.endsWith('5.92') ? 5.92 : Number(etapa.split('-')[1]));
      const margemEsperada = ((item.precoVendaAtual - 4.39) / item.precoVendaAtual) * 100;
      assert.ok(Math.abs(item.margem_lucro - margemEsperada) < 1e-10, `${etapa}: margem`);
    }
    assert.match(resultado.htmlAntesEditar, /data-margem-bruta-item="0">25\.84%<\/span>/);
    assert.match(resultado.htmlAntesEditar, /Custo anterior: R\$ 4\.38\. Novo custo: R\$ 4\.39/);
  }
});

test('auditoria final mapeia o fluxo funcional da linha Central NF-e', () => {
  const workflow = comprasSource.slice(
    workflowStart,
    comprasSource.indexOf('\n}\n', workflowStart)
  );
  const normalizeStart = comprasSource.indexOf('function normalizeItemCompra');
  const normalizeEnd = comprasSource.indexOf('\n}\n', normalizeStart) + 3;
  const normalize = comprasSource.slice(normalizeStart, normalizeEnd);
  const enrichStart = comprasSource.indexOf('async function enriquecerApresentacoesItensCentralCompra');
  const enrichEnd = comprasSource.indexOf('\n}\n', enrichStart) + 3;
  const enrich = comprasSource.slice(enrichStart, enrichEnd);
  const editStart = comprasSource.indexOf('function editarItemCompra');
  const editEnd = comprasSource.indexOf('\n}\n', editStart) + 3;
  const edit = comprasSource.slice(editStart, editEnd);
  const saveStart = comprasSource.indexOf('async function adicionarItemCompraAsync');
  const saveEnd = comprasSource.indexOf('\n}\n', saveStart) + 3;
  const save = comprasSource.slice(saveStart, saveEnd);

  const etapas = [
    ['NF/XML → itens', /const itensCompraImportados = Array\.isArray\(data\.itens\) \? data\.itens : \[\]/],
    ['associação da apresentação', /await enriquecerApresentacoesItensCentralCompra\(itensCompraImportados\)/],
    ['quantidade comercial', /item\.quantidade_comercial = quantidadeComercial/],
    ['apresentação/fator', /item\.quantidade_por_embalagem = quantidade/],
    ['conversão/quantidade total', /const quantidadeTributavelInformada = Number/],
    ['custo unitário', /resolverCustoUnitarioCentralNfe\(item\)/],
    ['margem', /calcularMargemBrutaCentralNfe\(custoMargemCentral, precoVenda\)/],
    ['preço de venda', /precoVendaAtualCentral/],
    ['subtotal da linha', /calcularSubtotalFinanceiroItemCompra\(\{\s*quantidade,\s*preco_unitario:/],
    ['alerta de custo', /const novo = resolverCustoUnitarioCentralNfe\(item\)/],
    ['criação do draft', /iniciarDraftCompraEdicao\(index\)/],
    ['restauração da embalagem', /restaurandoEmbalagemCompraEdicao = \{/],
    ['salvamento', /normalizeItemCompra\(\{/]
  ];

  assert.match(workflow, etapas[0][1], etapas[0][0]);
  assert.match(workflow, etapas[1][1], etapas[1][0]);
  for (const [nome, padrao] of etapas.slice(2, 4)) assert.match(enrich, padrao, nome);
  assert.match(normalize, etapas[4][1], etapas[4][0]);
  assert.match(normalize, etapas[5][1], etapas[5][0]);
  assert.match(normalize, /quantidadeTributavelInformada > 0[\s\S]*?item\.quantidade_convertida \?\? item\.quantidade/);
  assert.match(normalize, etapas[6][1], etapas[6][0]);
  assert.match(normalize, etapas[7][1], etapas[7][0]);
  assert.match(normalize, etapas[8][1], etapas[8][0]);
  assert.match(comprasSource, etapas[9][1], etapas[9][0]);
  assert.match(edit, etapas[10][1], etapas[10][0]);
  assert.match(edit, etapas[11][1], etapas[11][0]);
  assert.match(save, etapas[12][1], etapas[12][0]);

  assert.match(save, /const conv = edicaoCentral\s*\?\s*resolverSnapshotEmbalagemEdicaoCentral/);
  assert.match(save, /: await simularConversaoMucCompra\(true\)/);
  assert.match(save, /quantidade_convertida: conv\.qtdTotal/);

  const matrizFontes = {
    'Quantidade comercial': 'qCom/quantidade_comercial',
    Apresentação: 'apresentacao associada pela entrada',
    Fator: 'quantidade_por_embalagem/fator_conversao',
    'Qtd. total': 'quantidade_estoque ou quantidade_convertida já resolvida',
    Custo: 'custo_unitario_final → custo_unitario → preco_unitario',
    Margem: 'custo unitário + preço de venda efetivo',
    Preço: 'precoVendaAtual/precoVendaOriginal',
    Subtotal: 'quantidade consolidada × custo unitário',
    Alerta: 'custo_anterior_produto × custo unitário resolvido',
    Edição: 'snapshot consolidado da linha'
  };
  assert.deepEqual(Object.keys(matrizFontes), [
    'Quantidade comercial', 'Apresentação', 'Fator', 'Qtd. total',
    'Custo', 'Margem', 'Preço', 'Subtotal', 'Alerta', 'Edição'
  ]);
  assert.ok(Object.values(matrizFontes).every((fonte) => typeof fonte === 'string' && fonte.length > 0));
});

test('auditoria de coerência valida identidades por unidade, caixa, fardo, rolo e dados ausentes', () => {
  const context = {
    isOrigemCompraCentralNfe: () => true,
    formatCurrency: (valor) => `R$ ${Number(valor).toFixed(2)}`
  };
  vm.runInNewContext([
    extrairFuncao('calcularMargemBrutaCentralNfe'),
    extrairFuncao('resolverCustoUnitarioCentralNfe'),
    extrairFuncao('resolverSubtotalCentralNfe'),
    extrairFuncao('resolverVariacaoCustoEntradaCentral')
  ].join('\n'), context);

  const matriz = [
    {
      nome: 'UN',
      item: { quantidade_comercial: 100, quantidade_estoque: 100, quantidade_convertida: 100, unidade_comercial: 'UN', unidade_estoque: 'UN', quantidade_por_embalagem: 1, preco_apresentacao: 2, custo_unitario_final: 2, precoVendaAtual: 2.5, custo_anterior_produto: 1.9 },
      quantidadeComercial: 100, fator: 1, total: 100, precoApresentacao: 2, custo: 2, venda: 2.5, subtotal: 200
    },
    {
      nome: 'CAIXA',
      item: { quantidade_comercial: 10, quantidade_estoque: 120, quantidade_convertida: 120, unidade_comercial: 'CX', unidade_estoque: 'UN', quantidade_por_embalagem: 12, preco_apresentacao: 21, preco_unitario_comercial: 21, custo_unitario_final: 1.75, precoVendaAtual: 2.5, custo_anterior_produto: 1.7 },
      quantidadeComercial: 10, fator: 12, total: 120, precoApresentacao: 21, custo: 1.75, venda: 2.5, subtotal: 210
    },
    {
      nome: 'FARDO',
      item: { quantidade_comercial: 100, quantidade_estoque: 1000, quantidade_convertida: 1000, unidade_comercial: 'FD', unidade_estoque: 'UN', quantidade_por_embalagem: 10, preco_apresentacao: 43.9, preco_unitario_comercial: 43.9, custo_unitario_final: 4.39, preco_unitario: 43.9, precoVendaAtual: 5.92, custo_anterior_produto: 4.38, valor_total_embalagem: 4390 },
      quantidadeComercial: 100, fator: 10, total: 1000, precoApresentacao: 43.9, custo: 4.39, venda: 5.92, subtotal: 4390
    },
    {
      nome: 'ROLO',
      item: { quantidade_comercial: 5, quantidade_estoque: 500, quantidade_convertida: 500, unidade_comercial: 'ROLO', unidade_estoque: 'MT', quantidade_por_embalagem: 100, preco_apresentacao: 400, preco_unitario_comercial: 400, custo_unitario: 4, precoVendaAtual: 5, custo_anterior_produto: 3.9, valor_total_embalagem: 2000 },
      quantidadeComercial: 5, fator: 100, total: 500, precoApresentacao: 400, custo: 4, venda: 5, subtotal: 2000
    },
    {
      nome: 'sem apresentação/fator',
      item: { quantidade_comercial: 8, quantidade_estoque: 8, quantidade_convertida: 8, preco_unitario: 3, precoVendaAtual: 4, custo_anterior_produto: 2.9 },
      quantidadeComercial: 8, fator: null, total: 8, precoApresentacao: null, custo: 3, venda: 4, subtotal: 24
    },
    {
      nome: 'canônicos ausentes com total/fallback',
      item: { quantidade_comercial: 2, quantidade_estoque: 20, quantidade_convertida: 20, unidade_comercial: 'CX', unidade_estoque: 'UN', quantidade_por_embalagem: 10, preco_apresentacao: 30, preco_unitario_comercial: 30, valor_total_embalagem: 60, preco_unitario_trib: 3, precoVendaAtual: 4, custo_anterior_produto: 2.8 },
      quantidadeComercial: 2, fator: 10, total: 20, precoApresentacao: 30, custo: 3, venda: 4, subtotal: 60
    }
  ];

  for (const caso of matriz) {
    const { item } = caso;
    assert.equal(item.quantidade_comercial, caso.quantidadeComercial, `${caso.nome}: quantidade comercial`);
    assert.equal(context.resolverCustoUnitarioCentralNfe(item), caso.custo, `${caso.nome}: custo canônico`);
    assert.equal(context.resolverSubtotalCentralNfe(item), caso.subtotal, `${caso.nome}: subtotal`);
    assert.ok(
      Math.abs(context.calcularMargemBrutaCentralNfe(caso.custo, caso.venda)
        - ((caso.venda - caso.custo) / caso.venda) * 100) < 1e-10,
      `${caso.nome}: identidade da margem`
    );
    if (caso.fator !== null && caso.fator > 1) {
      assert.equal(caso.quantidadeComercial * caso.fator, caso.total, `${caso.nome}: identidade de quantidade`);
    }
    if (caso.precoApresentacao !== null && caso.fator > 1) {
      assert.equal(caso.precoApresentacao / caso.fator, caso.custo, `${caso.nome}: apresentação ÷ fator`);
    }
  }

  const fardo = matriz.find((caso) => caso.nome === 'FARDO').item;
  const alerta = context.resolverVariacaoCustoEntradaCentral(fardo);
  assert.deepEqual(JSON.parse(JSON.stringify(alerta)), {
    tipo: 'aumentou',
    anterior: 4.38,
    novo: 4.39
  });
  assert.equal(context.resolverCustoUnitarioCentralNfe({
    quantidade_estoque: null,
    quantidade_convertida: Infinity,
    custo_unitario_final: NaN,
    custo_unitario: null,
    preco_unitario: undefined
  }), null);
  assert.equal(context.resolverSubtotalCentralNfe({
    quantidade_estoque: 1,
    custo_unitario_final: null,
    custo_unitario: undefined,
    preco_unitario: NaN
  }), null);
  assert.equal(context.calcularMargemBrutaCentralNfe(null, 5.92), null);
});

test('Central converte apresentação para estoque sem duplicar qTrib', async () => {
  const casos = [
    {
      nome: 'FD',
      quantidade: 100,
      fator: 10,
      preco: 43.9,
      opcoes: { unidadeComercial: 'FD', tipoApresentacao: 'FD', unidadeEstoque: 'UN', quantidadeTributavel: 0 },
      total: 1000,
      unidade: 'UN'
    },
    {
      nome: 'CAIXA',
      quantidade: 50,
      fator: 12,
      preco: 120,
      opcoes: { unidadeComercial: 'CX', tipoApresentacao: 'CX', unidadeEstoque: 'UN', quantidadeTributavel: 0 },
      total: 600,
      unidade: 'UN'
    },
    {
      nome: 'ROLO',
      quantidade: 10,
      fator: 100,
      preco: 200,
      opcoes: { unidadeComercial: 'ROLO', tipoApresentacao: 'ROLO', unidadeEstoque: 'MT', quantidadeTributavel: 0 },
      total: 1000,
      unidade: 'MT'
    },
    {
      nome: 'UN',
      quantidade: 100,
      fator: 1,
      preco: 5,
      opcoes: { unidadeComercial: 'UN', tipoApresentacao: 'UN', unidadeEstoque: 'UN', unidadeTributavel: 'BASE', quantidadeTributavel: 0 },
      total: 100,
      unidade: 'UN'
    },
    {
      nome: 'qTrib já convertido',
      quantidade: 100,
      fator: 10,
      preco: 43.9,
      opcoes: { unidadeComercial: 'FD', tipoApresentacao: 'FD', unidadeEstoque: 'UN', quantidadeTributavel: 0, qTrib: 1000 },
      total: 1000,
      unidade: 'UN'
    }
  ];
  const custoContext = {};
  vm.runInNewContext([
    extrairFuncao('resolverCustoUnitarioCentralNfe'),
    extrairFuncao('resolverSubtotalCentralNfe'),
    extrairFuncao('calcularMargemBrutaCentralNfe')
  ].join('\n'), custoContext);

  for (const caso of casos) {
    const { item } = await prepararItemCentral(
      caso.quantidade,
      caso.fator,
      caso.preco,
      caso.opcoes
    );
    assert.equal(item.quantidade_comercial, caso.quantidade, `${caso.nome}: quantidade comercial`);
    assert.equal(item.fator_conversao, caso.fator, `${caso.nome}: fator`);
    assert.equal(item.quantidade_convertida, caso.total, `${caso.nome}: quantidade convertida`);
    assert.equal(item.quantidade_estoque, caso.total, `${caso.nome}: quantidade de estoque`);
    assert.equal(item.unidade_estoque, caso.unidade, `${caso.nome}: unidade de estoque`);
    assert.equal(item.unidade, caso.unidade, `${caso.nome}: unidade apresentada`);
    assert.equal(item.preco_unitario_comercial, caso.preco, `${caso.nome}: preço da apresentação`);
    assert.equal(
      custoContext.resolverCustoUnitarioCentralNfe(item),
      Number((caso.preco / caso.fator).toFixed(4)),
      `${caso.nome}: custo unitário existente`
    );
    if (caso.nome === 'FD') {
      const custo = custoContext.resolverCustoUnitarioCentralNfe(item);
      assert.equal(custo, 4.39);
      const itemNormalizado = {
        ...item,
        custo_unitario_final: custo,
        custo_unitario: custo,
        preco_unitario: custo
      };
      assert.equal(
        custoContext.calcularMargemBrutaCentralNfe(
          custoContext.resolverCustoUnitarioCentralNfe(itemNormalizado),
          5.92
        ).toFixed(2),
        '25.84'
      );
      assert.equal(custoContext.resolverSubtotalCentralNfe(itemNormalizado), 4390);
    }
  }
});

test('Central converte apresentação quando qTrib/uTrib da NF-e estão na unidade comercial', async () => {
  const casos = [
    {
      nome: 'A) FD com uTrib = FD',
      quantidade: 100,
      fator: 10,
      preco: 43.9,
      opcoes: { unidadeComercial: 'FD', tipoApresentacao: 'FD', unidadeEstoque: 'UN', unidadeTributavel: 'FD', quantidadeTributavel: 100, precoTributavel: 43.9 },
      total: 1000,
      unidade: 'UN',
      custo: 4.39
    },
    {
      nome: 'A) FD10 com uTrib = FD10',
      quantidade: 100,
      fator: 10,
      preco: 43.9,
      opcoes: { unidadeComercial: 'FD10', tipoApresentacao: 'FD', unidadeEstoque: 'UN', unidadeTributavel: 'FD10', quantidadeTributavel: 100, precoTributavel: 43.9 },
      total: 1000,
      unidade: 'UN',
      custo: 4.39
    },
    {
      nome: 'A) FD sem uTrib/qTrib',
      quantidade: 100,
      fator: 10,
      preco: 43.9,
      opcoes: { unidadeComercial: 'FD', tipoApresentacao: 'FD', unidadeEstoque: 'UN', unidadeTributavel: '', quantidadeTributavel: 0, qTrib: 0, precoTributavel: 0 },
      total: 1000,
      unidade: 'UN',
      custo: 4.39
    },
    {
      nome: 'B) CAIXA com uTrib = CX',
      quantidade: 50,
      fator: 12,
      preco: 120,
      opcoes: { unidadeComercial: 'CX', tipoApresentacao: 'CX', unidadeEstoque: 'UN', unidadeTributavel: 'CX', quantidadeTributavel: 50, precoTributavel: 120 },
      total: 600,
      unidade: 'UN',
      custo: 10
    },
    {
      nome: 'C) ROLO com uTrib = ROLO',
      quantidade: 10,
      fator: 100,
      preco: 200,
      opcoes: { unidadeComercial: 'ROLO', tipoApresentacao: 'ROLO', unidadeEstoque: 'MT', unidadeTributavel: 'ROLO', quantidadeTributavel: 10, precoTributavel: 200 },
      total: 1000,
      unidade: 'MT',
      custo: 2
    },
    {
      nome: 'E) qTrib = 1000 UN já convertido',
      quantidade: 100,
      fator: 10,
      preco: 43.9,
      opcoes: { unidadeComercial: 'FD', tipoApresentacao: 'FD', unidadeEstoque: 'UN', unidadeTributavel: 'UN', quantidadeTributavel: 1000, precoTributavel: 4.39 },
      total: 1000,
      unidade: 'UN',
      custo: 4.39
    }
  ];

  for (const caso of casos) {
    const { item } = await prepararItemCentral(caso.quantidade, caso.fator, caso.preco, caso.opcoes);
    assert.equal(item.quantidade_comercial, caso.quantidade, `${caso.nome}: quantidade comercial`);
    assert.equal(item.fator_conversao, caso.fator, `${caso.nome}: fator`);
    assert.equal(item.quantidade_por_embalagem, caso.fator, `${caso.nome}: quantidade por embalagem`);
    assert.equal(item.quantidade_convertida, caso.total, `${caso.nome}: quantidade convertida`);
    assert.equal(item.quantidade_estoque, caso.total, `${caso.nome}: quantidade de estoque`);
    assert.equal(item.unidade_estoque, caso.unidade, `${caso.nome}: unidade de estoque`);
    assert.equal(item.unidade, caso.unidade, `${caso.nome}: unidade`);
    assert.equal(item.preco_apresentacao, caso.preco, `${caso.nome}: preço da apresentação`);
    assert.equal(item.preco_unitario_comercial, caso.preco, `${caso.nome}: preço comercial`);
    assert.equal(item.custo_unitario_final, caso.custo, `${caso.nome}: custo unitário`);
    assert.equal(item.custo_unitario, caso.custo, `${caso.nome}: custo unitário`);
    assert.equal(item.preco_unitario, caso.custo, `${caso.nome}: preço unitário de estoque`);
  }

  const { item: unidade } = await prepararItemCentral(100, 1, 5, {
    unidadeComercial: 'UN',
    tipoApresentacao: 'UN',
    unidadeEstoque: 'UN',
    unidadeTributavel: 'UN',
    quantidadeTributavel: 100,
    precoTributavel: 5
  });
  assert.equal(unidade.quantidade_comercial, 100, 'D) UN: quantidade comercial');
  assert.equal(unidade.quantidade_tributavel, 100, 'D) UN: 100 UN × 1 permanece 100 UN');
  assert.equal(unidade.apresentacao_central_resolvida, undefined, 'D) UN: sem conversão de apresentação');
});

test('Central leva quantidade convertida e unidade de estoque da apresentação até o renderer', async () => {
  const cenarios = [
    {
      nome: 'uTrib = FD',
      unidadeComercial: 'FD',
      xml: { unidade_tributavel: 'FD', uTrib: 'FD', quantidade_tributavel: 100, qTrib: 100, preco_unitario_trib: 43.9 }
    },
    {
      nome: 'uTrib = FD10',
      unidadeComercial: 'FD10',
      xml: { unidade_tributavel: 'FD10', uTrib: 'FD10', quantidade_tributavel: 100, qTrib: 100, preco_unitario_trib: 43.9 }
    },
    {
      nome: 'qTrib = 1000 UN',
      unidadeComercial: 'FD',
      xml: {}
    }
  ];
  for (const { nome, unidadeComercial, xml } of cenarios) {
    const fluxo = await executarFluxoMargemCentral({ unidadeComercial, xml });
    for (const [etapa, item] of [
      ['enriquecido', fluxo.antesNormalize],
      ['normalizado', fluxo.depoisNormalize],
      ['antes do render', fluxo.imediatamenteAntesRender]
    ]) {
      assert.equal(item.quantidade_comercial, 100, `${nome}/${etapa}: quantidade comercial`);
      assert.equal(item.quantidade_convertida, 1000, `${nome}/${etapa}: quantidade convertida`);
      assert.equal(item.quantidade_estoque, 1000, `${nome}/${etapa}: quantidade de estoque`);
      assert.equal(item.unidade_estoque, 'UN', `${nome}/${etapa}: unidade de estoque`);
      assert.equal(item.unidade, 'UN', `${nome}/${etapa}: unidade`);
      assert.equal(item.preco_apresentacao, 43.9, `${nome}/${etapa}: preço da apresentação`);
      assert.equal(item.custo_unitario_final, 4.39, `${nome}/${etapa}: custo unitário`);
    }
    assert.equal(fluxo.antesNormalize.fator_conversao, 10, `${nome}: fator`);
    assert.equal(fluxo.custoNaMargem, 4.39, `${nome}: custo usado na margem`);
    assert.match(fluxo.htmlAntesEditar, /1000 UN/, `${nome}: quantidade total exibida em UN`);
    assert.doesNotMatch(fluxo.htmlAntesEditar, /1000 FD|0 FD10/, `${nome}: quantidade não fica na unidade comercial`);
    assert.equal(fluxo.margemAntesEditar, '25.84%', `${nome}: margem do fluxo existente`);
    assert.equal(fluxo.subtotalAntesRender, 4390, `${nome}: subtotal do fluxo existente`);
  }
});

test('first Central render receives normalized unit cost', async () => {
  const { item } = await prepararItemCentral(100, 10, 43.9, {
    unidadeComercial: 'FD',
    tipoApresentacao: 'FD',
    unidadeEstoque: 'UN',
    quantidadeTributavel: 1000
  });
  assert.equal(item.preco_apresentacao, 43.9);
  assert.equal(item.preco_unitario_comercial, 43.9);
  assert.equal(item.quantidade_convertida, 1000);
  assert.equal(item.quantidade_estoque, 1000);
  assert.equal(item.custo_unitario_final, 4.39);
  assert.equal(item.custo_unitario, 4.39);
  assert.equal(item.preco_unitario, 4.39);

  const fluxo = await executarFluxoMargemCentral();
  assert.equal(fluxo.depoisNormalize.preco_apresentacao, 43.9);
  assert.equal(fluxo.depoisNormalize.preco_unitario_comercial, 43.9);
  assert.equal(fluxo.depoisNormalize.quantidade_estoque, 1000);
  assert.equal(fluxo.depoisNormalize.custo_unitario_final, 4.39);
  assert.equal(fluxo.depoisNormalize.custo_unitario, 4.39);
  assert.equal(fluxo.depoisNormalize.preco_unitario, 4.39);
  assert.equal(fluxo.imediatamenteAntesRender.custo_unitario_final, 4.39);
  assert.match(fluxo.htmlAntesEditar, /<td style="min-width:110px;">\s*R\$ 4\.39/);
});

test('subtotal Central usa quantidade convertida e custo unitário sem nova conversão', () => {
  const source = extrairFuncao('resolverCustoUnitarioCentralNfe')
    + '\n'
    + extrairFuncao('resolverSubtotalCentralNfe');
  const context = {
    calcularSubtotalFinanceiroItemCompra: (item) => item.quantidade * item.preco_unitario
  };
  vm.runInNewContext(source, context);

  const casos = [
    { nome: 'UN', item: { quantidade_estoque: 100, custo_unitario_final: 2 }, esperado: 200 },
    { nome: 'CAIXA', item: { quantidade_estoque: 120, quantidade_comercial: 10, quantidade_por_embalagem: 12, custo_unitario_final: 1.75 }, esperado: 210 },
    { nome: 'ROLO', item: { quantidade_estoque: 500, quantidade_comercial: 5, quantidade_por_embalagem: 100, custo_unitario_final: 4 }, esperado: 2000 },
    {
      nome: 'FARDO sem dupla conversão',
      item: {
        quantidade_estoque: 1000,
        quantidade_convertida: 1000,
        quantidade_comercial: 100,
        quantidade_por_embalagem: 10,
        custo_unitario_final: 4.39,
        preco_unitario: 43.9,
        preco_apresentacao: 43.9,
        valor_total_embalagem: 4390
      },
      esperado: 4390
    },
    {
      nome: 'apresentação sem fator',
      item: {
        quantidade_estoque: 4,
        quantidade_comercial: 4,
        preco_apresentacao: 5,
        custo_unitario_final: 5
      },
      esperado: 20
    },
    {
      nome: 'quantidade convertida tem prioridade',
      item: { quantidade_estoque: 1000, quantidade_convertida: 1000, quantidade_comercial: 100, quantidade_por_embalagem: 10, custo_unitario_final: 4.39 },
      esperado: 4390
    }
  ];
  for (const caso of casos) {
    assert.equal(context.resolverSubtotalCentralNfe(caso.item), caso.esperado, caso.nome);
  }
  assert.equal(context.resolverSubtotalCentralNfe({ quantidade_estoque: 1, custo_unitario_final: null }), null);
  assert.equal(context.resolverSubtotalCentralNfe({ quantidade_estoque: Infinity, custo_unitario_final: 1 }), null);
  assert.equal(context.resolverSubtotalCentralNfe({
    quantidade_estoque: 1e308,
    custo_unitario_final: 1e308
  }), null);
});

test('margem da Central usa apenas custo unitário canônico e fórmula de margem bruta', () => {
  const margemStart = comprasSource.indexOf('function calcularMargemBrutaCentralNfe');
  const margemEnd = comprasSource.indexOf('\n}\n', margemStart) + 3;
  const custoStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const custoEnd = comprasSource.indexOf('\n}\n', custoStart) + 3;
  const context = {};
  vm.runInNewContext(
    `${comprasSource.slice(margemStart, margemEnd)}\n${comprasSource.slice(custoStart, custoEnd)}`,
    context
  );

  const casos = [
    {
      nome: 'unidade com margem de 50%',
      item: { custo_unitario_final: 2, preco_unitario: 99 },
      venda: 4,
      margem: 50
    },
    {
      nome: 'unidade com margem de 25,83%',
      item: { custo_unitario: 1.78, preco_unitario: 99 },
      venda: 2.4,
      margem: 25.83
    },
    {
      nome: 'caixa não usa preço da apresentação',
      item: {
        quantidade_comercial: 1,
        quantidade_por_embalagem: 10,
        preco_apresentacao: 17.5,
        preco_unitario_comercial: 17.5,
        quantidade_estoque: 10,
        custo_unitario_final: 1.75,
        preco_unitario: 17.5
      },
      venda: 2.36,
      margem: 25.85
    },
    {
      nome: 'rolo usa custo por metro',
      item: {
        quantidade_comercial: 1,
        quantidade_por_embalagem: 100,
        preco_apresentacao: 200,
        preco_unitario_comercial: 200,
        quantidade_estoque: 100,
        custo_unitario_final: 2,
        preco_unitario: 200
      },
      venda: 4,
      margem: 50
    },
    {
      nome: 'fardo usa custo por unidade',
      item: {
        quantidade_comercial: 100,
        quantidade_por_embalagem: 10,
        preco_apresentacao: 43.9,
        preco_unitario_comercial: 43.9,
        quantidade_estoque: 1000,
        custo_unitario_final: 4.39,
        preco_unitario: 43.9,
        valor_total_embalagem: 4390
      },
      venda: 5.92,
      margem: 25.84
    }
  ];
  for (const caso of casos) {
    const custo = context.resolverCustoUnitarioCentralNfe(caso.item);
    const margem = context.calcularMargemBrutaCentralNfe(custo, caso.venda);
    assert.equal(custo, caso.item.custo_unitario_final ?? caso.item.custo_unitario);
    assert.equal(Number(margem.toFixed(2)), caso.margem, caso.nome);
  }

  assert.equal(context.resolverCustoUnitarioCentralNfe({
    custo_unitario: 3.25,
    preco_unitario: 8,
    custo_unitario_final: 2.5
  }), 2.5);
  assert.equal(context.resolverCustoUnitarioCentralNfe({
    preco_unitario_trib: 1.75,
    preco_apresentacao: 17.5
  }), 1.75, 'fallback tributável não usa preço da apresentação');
  assert.equal(context.calcularMargemBrutaCentralNfe(0, 4), 100);
  assert.equal(context.calcularMargemBrutaCentralNfe(null, 4), null);
  assert.equal(context.calcularMargemBrutaCentralNfe(2, 0), null);
  assert.equal(context.calcularMargemBrutaCentralNfe(2, null), null);
  assert.equal(context.calcularMargemBrutaCentralNfe(2, Infinity), null);
});

test('tabela Central organiza as colunas e exibe custo unitário sem alterar quantidade, subtotal ou ações', async () => {
  const tabelaStart = comprasSource.indexOf('<div class="table-responsive mt-3" id="itensCompraTable">');
  const tabelaEnd = comprasSource.indexOf('</table>', tabelaStart);
  assert.notEqual(tabelaStart, -1);
  assert.notEqual(tabelaEnd, -1);
  const templateTabela = comprasSource.slice(tabelaStart, tabelaEnd);
  const colunas = [
    '<th>Produto / descrição</th>',
    '<th>Cód. barras</th>',
    '<th>Validade</th>',
    '<th>CFOP / Fiscal</th>',
    '<th id="colunaQuantidadeCompraHeader">Qtd Fiscal</th>',
    "isOrigemCompraCentralNfe() ? 'Valor unitário de compra'",
    '<th>Qtd. total</th>',
    "isOrigemCompraCentralNfe() ? 'Margem bruta %'",
    '<th>Preço de venda</th>',
    '<th>Subtotal</th>',
    "isOrigemCompraCentralNfe() ? 'Ações'"
  ];
  let ultimaPosicao = -1;
  for (const coluna of colunas) {
    const posicao = templateTabela.indexOf(coluna);
    assert.ok(posicao > ultimaPosicao, `coluna ${coluna} deve seguir a ordem definida`);
    ultimaPosicao = posicao;
  }
  assert.match(templateTabela, /isOrigemCompraCentralNfe\(\) \? '<th>Qtd\. total<\/th>' : ''/);

  const { htmlAntesEditar, htmlDepoisEditar } = await executarFluxoMargemCentral();
  assert.equal((htmlAntesEditar.match(/<td(?:\s|>)/g) || []).length, 11);
  assert.doesNotMatch(htmlAntesEditar, /Preço da apresentação/);
  assert.match(htmlAntesEditar, /<td style="min-width:110px;">\s*R\$ 4\.39/);
  assert.match(htmlDepoisEditar, /<td style="min-width:110px;">\s*R\$ 4\.39/);
  assert.match(htmlDepoisEditar, /<td>R\$ 4390\.00<\/td>/);
  const quantidadeTotal = htmlAntesEditar.indexOf('1000 UN');
  const margem = htmlAntesEditar.indexOf('data-margem-bruta-item="0"');
  const precoVenda = htmlAntesEditar.indexOf('data-preco-venda-item="0"');
  const subtotal = htmlAntesEditar.indexOf('<td>R$ 4390.00</td>');
  const editar = htmlAntesEditar.indexOf('onclick="editarItemCompra(0)"');
  const excluir = htmlAntesEditar.indexOf('onclick="removerItemCompra(0)"');
  const valorUnitario = htmlAntesEditar.indexOf('R$ 4.39');
  assert.ok(valorUnitario < quantidadeTotal);
  assert.ok(quantidadeTotal < margem);
  assert.ok(margem < precoVenda);
  assert.ok(precoVenda < subtotal);
  assert.ok(subtotal < editar);
  assert.ok(editar < excluir);
});

test('usa fator cadastrado compatível quando o código comercial da NF-e não coincide', () => {
  const context = {
    ProdutoApresentacaoResolver: criarResolvers()
  };
  vm.runInNewContext(`${comprasHelpers};`, context);
  const apresentacao = {
    id: 772,
    tipo: 'FD',
    quantidade: 10,
    unidade: 'UN',
    principal: 1,
    compra: 1,
    ativa: 1
  };
  const produto = {
    id: 9182,
    unidade: 'UN',
    compra_por_embalagem: 0,
    embalagens: [apresentacao]
  };
  const item = {
    unidade_comercial: 'UN',
    unidade_tributavel: 'UN',
    quantidade_comercial: 1,
    quantidade_tributavel: 10
  };

  assert.equal(context.resolverApresentacaoItemCentralCompra(item, produto).id, apresentacao.id);
});

test('NF-e em UN no preço do pacote cadastrado vira custo unitário', async () => {
  const produtoId = 93;
  const produto = {
    id: produtoId,
    nome: 'CABO PP 2 X 2,50',
    unidade: 'UN',
    unidade_comercial: 'PACOTE',
    compra_por_embalagem: 1,
    quantidade_por_embalagem: 100,
    valor_compra_embalagem: 615,
    preco_compra: 6.15,
    preco_venda: 8.3,
    embalagens: [{
      id: 7,
      produto_id: produtoId,
      tipo: 'PCT',
      quantidade: 100,
      unidade: 'un',
      valor_compra: 615,
      principal: 1,
      compra: 1,
      ativa: 1
    }]
  };
  const context = {
    API_URL: '/api',
    produtosCompraList: [{ ...produto, embalagens: [] }],
    ProdutoApresentacaoResolver: criarResolvers(),
    localStorage: { getItem: () => 'test-token' },
    fetch: async () => ({
      ok: true,
      json: async () => produto
    }),
    $: () => ({ append: () => {} }),
    escapeHtml: (value) => String(value)
  };
  vm.runInNewContext([
    extrairFuncao('resolverCustoUnitarioCentralNfe'),
    extrairFuncao('calcularMargemBrutaCentralNfe'),
    comprasHelpers
  ].join('\n'), context);

  const item = {
    produto_id: produtoId,
    produto_nome: 'CABO PP 2 X 2,50',
    quantidade: 1,
    unidade: 'UN',
    preco_unitario: 615,
    subtotal: 615,
    custo_anterior_produto: 6.15
  };
  await context.enriquecerApresentacoesItensCentralCompra([item]);

  assert.equal(item.apresentacao_central_resolvida, true);
  assert.equal(item.quantidade_comercial, 1);
  assert.equal(item.quantidade_estoque, 100);
  assert.equal(item.quantidade_por_embalagem, 100);
  assert.ok(Math.abs(item.preco_unitario - 6.15) < 0.0001);
  assert.equal(item.preco_unitario_comercial, 615);
  assert.equal(item.subtotal, 615);
  const margem = context.calcularMargemBrutaCentralNfe(item.preco_unitario, 8.3);
  assert.ok(Math.abs(margem - ((8.3 - 6.15) / 8.3) * 100) < 0.0001);
  assert.ok(margem > 25 && margem < 26);

  const unitario = {
    produto_id: produtoId,
    quantidade: 1,
    unidade: 'UN',
    preco_unitario: 6.15,
    subtotal: 6.15
  };
  await context.enriquecerApresentacoesItensCentralCompra([unitario]);
  assert.equal(unitario.apresentacao_central_resolvida, undefined);
  assert.equal(unitario.preco_unitario, 6.15);
  assert.equal(unitario.quantidade_estoque, undefined);

  const caixa = {
    produto_id: produtoId,
    quantidade: 1,
    unidade: 'CX',
    unidade_comercial: 'CX',
    preco_unitario: 615,
    subtotal: 615
  };
  await context.enriquecerApresentacoesItensCentralCompra([caixa]);
  assert.equal(caixa.apresentacao_central_resolvida, undefined);
  assert.equal(caixa.preco_unitario, 615);
});

test('edição da linha Central restaura a apresentação e nunca regride fator válido para zero', () => {
  const normalizeStart = comprasSource.indexOf('function normalizarUnidadeApresentacaoCentralCompra');
  const normalizeEnd = comprasSource.indexOf('\n}\n', normalizeStart) + 3;
  const restoreStart = comprasSource.indexOf('function resolverEmbalagemRestauradaCompra');
  const restoreEnd = comprasSource.indexOf('\n}\n', restoreStart) + 3;
  const context = {
    embalagensProdutoCompraAtual: [
      { id: 'unidade-base-9182', tipo: 'UN', quantidade: 1, unidade: 'UN', compra: 1 },
      { id: 772, tipo: 'FD', quantidade: 10, unidade: 'UN', compra: 1, principal: 1 }
    ]
  };
  vm.runInNewContext(
    `${comprasSource.slice(normalizeStart, normalizeEnd)}\n${comprasSource.slice(restoreStart, restoreEnd)}`,
    context
  );

  const selected = context.resolverEmbalagemRestauradaCompra({
    compra_em: 'Unidade',
    unidade_comercial: 'FD10',
    quantidade_por_embalagem: 0,
    fator_conversao: 10,
    unidade: 'UN'
  }, { id: 9182, unidade: 'UN' });

  assert.equal(selected.id, 772);
  assert.equal(selected.quantidade, 10);

  const restoringStart = comprasSource.indexOf('if (restaurandoEmbalagemCompraEdicao) {');
  const restoringEnd = comprasSource.indexOf('const ultima = obterUltimaEmbalagemCompraProduto', restoringStart);
  const restoringBranch = comprasSource.slice(restoringStart, restoringEnd);
  assert.match(restoringBranch, /r\.embalagem_id \|\| r\.produto_apresentacao_id/);
  assert.match(restoringBranch, /fatorRestaurado/);
  assert.doesNotMatch(restoringBranch, /val\(formatQuantidadeExibicao\(r\.quantidade_por_embalagem \|\| 0/);
});

test('edição Central restaura custo e quantidade resolvidos sem executar nova conversão', () => {
  const context = {
    embalagensProdutoCompraAtual: [{
      id: 772,
      tipo: 'FD',
      quantidade: 10,
      unidade: 'UN',
      compra: 1
    }],
    restaurandoEmbalagemCompraEdicao: {
      embalagem_id: 772,
      compra_em: 'FD',
      unidade_comercial: 'FD',
      unidade: 'UN',
      quantidade_embalagens: 100,
      quantidade_por_embalagem: 10,
      quantidade_estoque: 1000,
      quantidade_convertida: 1000,
      preco_unitario: 43.9,
      preco_unitario_comercial: 43.9,
      custo_unitario_final: 4.39,
      custo_unitario: 43.9,
      preco_apresentacao: 43.9,
      valor_total_embalagem: 4390,
      subtotal: 4390
    },
    TIPOS_COMPRA_EMBALAGEM: ['UN', 'FD', 'CX'],
    formatQuantidadeExibicao: (valor) => String(Number(valor)),
    formatNumberInput: (valor) => Number(valor).toFixed(2),
    formatarCustoUnitarioVenda: (valor) => Number(valor).toFixed(4),
    rotuloTipoEmbalagemCompra: () => 'Fardo',
    pluralizarTipoEmbalagem: (tipo, quantidade) => quantidade === 1 ? tipo : `${tipo}s`,
    obterProdutoSelecionadoCompra: () => ({ id: 9182, unidade: 'UN' }),
    isOrigemCompraCentralNfe: () => true,
    isModoEmbalagemComercialCompraAtivo: () => true,
    embalagemCompraEhUnidade: () => false,
    resolverEmbalagemRestauradaCompra: (_item, produto) => context.embalagensProdutoCompraAtual[0],
    obterPrecoUnitarioCompraFormulario: () => ({ valor: 43.9 }),
    obterModoPainelEmbalagemCompra: () => 'COMERCIAL',
    atualizarPainelResumoConversaoMuc: (resultado) => {
      context.resumoRestaurado = resultado;
    },
    renderSelectEmbalagemCompra: () => {},
    renderPainelConteudoEmbalagensCompra: () => {},
    agendarSimulacaoMucCompra: () => {
      context.simulacoesAgendadas = (context.simulacoesAgendadas || 0) + 1;
    },
    simulacoesAgendadas: 0
  };
  const campos = new Map();
  context.$ = (seletor) => {
    if (!campos.has(seletor)) campos.set(seletor, { valor: '', texto: '', html: '' });
    const campo = campos.get(seletor);
    return {
      length: 1,
      val(valor) {
        if (arguments.length) {
          campo.valor = valor;
          return this;
        }
        return campo.valor;
      },
      text(valor) {
        if (arguments.length) {
          campo.texto = valor;
          return this;
        }
        return campo.texto;
      },
      html(valor) {
        if (arguments.length) {
          campo.html = valor;
          return this;
        }
        return campo.html;
      },
      addClass() { return this; },
      removeClass() { return this; },
      toggleClass() { return this; }
    };
  };

  vm.runInNewContext([
    extrairFuncao('resolverCustoUnitarioCentralNfe'),
    extrairFuncao('restaurarResumoConversaoMucEdicaoCentral'),
    extrairFuncao('resolverSnapshotEmbalagemEdicaoCentral'),
    extrairFuncao('aplicarEmbalagemCompraSelecionada'),
    extrairFuncao('finalizarPainelEmbalagemComercialCompra')
  ].join('\n'), context);
  context.finalizarPainelEmbalagemComercialCompra({ id: 9182, unidade: 'UN' });

  assert.equal(context.simulacoesAgendadas, 0, 'restauração de edição não deve agendar MUC');
  assert.equal(context.resumoRestaurado.quantidadeEstoque, 1000, 'deve exibir a quantidade convertida persistida sem multiplicá-la pelo fator');
  assert.equal(context.resumoRestaurado.custoUnitario, 4.39, 'deve exibir custo unitário canônico, não o preço da apresentação');
  assert.equal(campos.get('#resultado_qtd_total_fracionado').texto, '1000 UN');
  assert.equal(campos.get('#resultado_custo_unitario_fracionado').texto, 'R$ 4.3900');
  assert.equal(campos.get('#preco_item').valor, '43.90', 'o preço da apresentação permanece no campo da embalagem');
  assert.equal(context.restaurandoEmbalagemCompraEdicao, null);
  const snapshotParaSalvar = context.resolverSnapshotEmbalagemEdicaoCentral(
    {
      quantidade_estoque: 1000,
      custo_unitario_final: 4.39,
      quantidade_comercial: 100,
      quantidade_por_embalagem: 10,
      valor_total_embalagem: 4390,
      unidade_estoque: 'UN'
    },
    100,
    43.9
  );
  assert.equal(snapshotParaSalvar.qtdTotal, 1000);
  assert.equal(snapshotParaSalvar.custoUnitario, 4.39);
  assert.equal(snapshotParaSalvar.valorTotal, 4390);
  assert.equal(snapshotParaSalvar.muc.fatorConversao, 10);

  const snapshots = [
    { nome: 'UN', item: { quantidade_estoque: 100, custo_unitario_final: 2, valor_total_embalagem: 200 }, quantidade: 100, custo: 2 },
    { nome: 'CAIXA', item: { quantidade_estoque: 120, quantidade_comercial: 10, quantidade_por_embalagem: 12, custo_unitario: 1.75, valor_total_embalagem: 210 }, quantidade: 120, custo: 1.75 },
    { nome: 'ROLO', item: { quantidade_convertida: 500, quantidade_comercial: 5, quantidade_por_embalagem: 100, preco_unitario: 4, valor_total_embalagem: 2000 }, quantidade: 500, custo: 4 },
    { nome: 'sem apresentação', item: { quantidade_estoque: 3, custo_unitario_final: 5, valor_total_embalagem: 15 }, quantidade: 3, custo: 5 }
  ];
  for (const caso of snapshots) {
    const snapshot = context.resolverSnapshotEmbalagemEdicaoCentral(caso.item);
    assert.equal(snapshot.qtdTotal, caso.quantidade, caso.nome);
    assert.equal(snapshot.custoUnitario, caso.custo, caso.nome);
  }
  assert.equal(context.resolverSnapshotEmbalagemEdicaoCentral({
    quantidade_estoque: Infinity,
    custo_unitario_final: 4.39,
    valor_total_embalagem: 439
  }), null, 'valores indisponíveis não devem produzir resumo numérico inválido');

  const margem = (venda) => ((venda - context.resumoRestaurado.custoUnitario) / venda) * 100;
  assert.equal(Number(margem(5.92).toFixed(2)), 25.84);
  assert.equal(Number(margem(6).toFixed(2)), 26.83);
  assert.equal(Number(margem(7).toFixed(2)), 37.29);

  const snapshotStart = comprasSource.indexOf('function restaurarResumoConversaoMucEdicaoCentral');
  const snapshotEnd = comprasSource.indexOf('\n}\n', snapshotStart) + 3;
  const snapshot = comprasSource.slice(snapshotStart, snapshotEnd);
  assert.doesNotMatch(snapshot, /simularConversaoMucCompra|obterQuantidadeConvertidaItemCompra/);
  const salvarStart = comprasSource.indexOf('async function adicionarItemCompraAsync');
  const salvarEnd = comprasSource.indexOf('\n}\n', salvarStart) + 3;
  const salvar = comprasSource.slice(salvarStart, salvarEnd);
  assert.match(salvar, /const conv = edicaoCentral\s*\?\s*resolverSnapshotEmbalagemEdicaoCentral[\s\S]*?: await simularConversaoMucCompra\(true\)/);
  assert.match(salvar, /!edicaoCentral && embSel/);
});

test('fluxo Central enriquece apresentação antes de normalizar e renderizar', () => {
  const workflow = comprasSource.slice(workflowStart, comprasSource.indexOf('\n}\n', workflowStart));
  assert.match(workflow, /await enriquecerApresentacoesItensCentralCompra\(itensCompraImportados\)/);
  assert.ok(
    workflow.indexOf('await enriquecerApresentacoesItensCentralCompra')
      < workflow.indexOf('const itemNormalizado = normalizeItemCompra(itemFiscal)'),
    'apresentação precisa ser associada antes da normalização da linha'
  );
  assert.match(comprasSource, /isOrigemCompraCentralNfe\(\)\s*&& produto\.central_nfe_usa_apresentacao_compra === true/);
  const painelStart = comprasSource.indexOf('function atualizarPainelConversaoUnidadesCompra');
  const painelEnd = comprasSource.indexOf('\n}\n', painelStart);
  const painel = comprasSource.slice(painelStart, painelEnd);
  assert.match(painel, /produtoUsaEmbalagemComercialCompra\(produto\)/);
  assert.match(painel, /produtoUsaEmbalagemComercialCompra\(atual\)/);
});

test('Central calcula margem bruta com custo unitário do estoque, não preço da embalagem', () => {
  const marginStart = comprasSource.indexOf('function calcularMargemBrutaCentralNfe');
  const costStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe', marginStart);
  const costEnd = comprasSource.indexOf('\n}\n', costStart) + 3;
  const context = {};
  vm.runInNewContext(
    `${comprasSource.slice(marginStart, costStart)}${comprasSource.slice(costStart, costEnd)}`,
    context
  );
  const fardo = {
    preco_unitario: 43.9,
    preco_unitario_comercial: 43.9,
    preco_apresentacao: 43.9,
    quantidade_comercial: 100,
    quantidade_por_embalagem: 10,
    quantidade_convertida: 1000,
    quantidade_estoque: 1000,
    valor_total_embalagem: 4390,
    subtotal: 4390,
    custo_unitario_final: 4.39
  };
  const custoUnitario = context.resolverCustoUnitarioCentralNfe(fardo);
  const margem = context.calcularMargemBrutaCentralNfe(custoUnitario, 5.92);

  assert.equal(custoUnitario, 4.39);
  assert.equal(Number(margem.toFixed(2)), 25.84);
  assert.notEqual(
    Number(context.calcularMargemBrutaCentralNfe(43.9, 5.92).toFixed(2)),
    25.84
  );
  const resumoStart = comprasSource.indexOf('function renderResumoConversaoItemCompraHtml');
  const resumoEnd = comprasSource.indexOf('\n}\n', resumoStart) + 3;
  assert.match(comprasSource.slice(resumoStart, resumoEnd), /const rotuloCusto = ehCentralNfe \? 'Custo unitário'/);
});

test('importação Central sem edição usa preço tributável quando o custo legado ainda é o preço da apresentação', () => {
  const marginStart = comprasSource.indexOf('function calcularMargemBrutaCentralNfe');
  const costStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const costEnd = comprasSource.indexOf('\n}\n', costStart) + 3;
  const context = {};
  vm.runInNewContext(
    `${comprasSource.slice(marginStart, costStart)}${comprasSource.slice(costStart, costEnd)}`,
    context
  );
  const itemImportadoSemEdicao = {
    unidade_comercial: 'FD',
    unidade_tributavel: 'UN',
    quantidade_comercial: 100,
    quantidade_convertida: 100,
    quantidade_por_embalagem: 10,
    preco_unitario: 43.9,
    preco_unitario_comercial: 43.9,
    preco_unitario_trib: 4.39,
    preco_apresentacao: 43.9,
    custo_unitario_final: 43.9,
    subtotal: 4390
  };

  const custo = context.resolverCustoUnitarioCentralNfe(itemImportadoSemEdicao);
  const margem = context.calcularMargemBrutaCentralNfe(custo, 5.92);

  assert.equal(custo, 4.39);
  assert.equal(Number(margem.toFixed(2)), 25.84);
  assert.equal(itemImportadoSemEdicao.preco_apresentacao, 43.9);

  const itemSemPrecoTributavel = {
    unidade_comercial: 'FD',
    unidade_tributavel: 'UN',
    quantidade_comercial: 100,
    quantidade_estoque: 100,
    quantidade_convertida: 100,
    quantidade_por_embalagem: 10,
    preco_unitario: 43.9,
    preco_unitario_comercial: 43.9,
    preco_apresentacao: 43.9,
    custo_unitario_final: 43.9,
    subtotal: 4390
  };
  const custoDerivado = context.resolverCustoUnitarioCentralNfe(itemSemPrecoTributavel);
  assert.equal(custoDerivado, 4.39);
  assert.equal(
    Number(context.calcularMargemBrutaCentralNfe(custoDerivado, 5.92).toFixed(2)),
    25.84
  );

  const itemComPrecoTributavelSemUnidades = {
    preco_unitario: 43.9,
    preco_unitario_comercial: 43.9,
    preco_apresentacao: 43.9,
    preco_unitario_trib: 4.39,
    custo_unitario_final: 43.9,
    quantidade_comercial: 100,
    subtotal: 4390
  };
  const custoTributavel = context.resolverCustoUnitarioCentralNfe(itemComPrecoTributavelSemUnidades);
  assert.equal(custoTributavel, 4.39);
  assert.equal(
    Number(context.calcularMargemBrutaCentralNfe(custoTributavel, 5.92).toFixed(2)),
    25.84
  );
});

test('custo por unidade também é separado para rolo/unidade linear', () => {
  const marginStart = comprasSource.indexOf('function calcularMargemBrutaCentralNfe');
  const costStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const costEnd = comprasSource.indexOf('\n}\n', costStart) + 3;
  const context = {};
  vm.runInNewContext(
    `${comprasSource.slice(marginStart, costStart)}${comprasSource.slice(costStart, costEnd)}`,
    context
  );

  const custoUnitario = context.resolverCustoUnitarioCentralNfe({
    quantidade_comercial: 1,
    quantidade_por_embalagem: 100,
    tipo_conversao: 'LINEAR',
    preco_unitario_comercial: 200,
    valor_total_embalagem: 200,
    quantidade_convertida: 100
  });
  assert.equal(custoUnitario, 2);
  assert.equal(
    Number(context.calcularMargemBrutaCentralNfe(custoUnitario, 2.7).toFixed(2)),
    25.93
  );
});

test('Central divide pelo total efetivamente convertido para caixa e unidade, uma única vez', () => {
  const marginStart = comprasSource.indexOf('function calcularMargemBrutaCentralNfe');
  const costStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const costEnd = comprasSource.indexOf('\n}\n', costStart) + 3;
  const context = {};
  vm.runInNewContext(
    `${comprasSource.slice(marginStart, costStart)}${comprasSource.slice(costStart, costEnd)}`,
    context
  );

  const custoCaixa = context.resolverCustoUnitarioCentralNfe({
    preco_unitario_comercial: 120,
    quantidade_comercial: 1,
    quantidade_convertida: 12,
    valor_total_embalagem: 120,
    quantidade_por_embalagem: 12,
    custo_unitario_final: 10
  });
  assert.equal(custoCaixa, 10);
  assert.equal(Number(context.calcularMargemBrutaCentralNfe(custoCaixa, 15).toFixed(2)), 33.33);

  assert.equal(context.resolverCustoUnitarioCentralNfe({
    preco_unitario_comercial: 5,
    quantidade_comercial: 1,
    quantidade_convertida: 1,
    valor_total_embalagem: 5,
    quantidade_por_embalagem: 1
  }), 5);

  assert.equal(context.resolverCustoUnitarioCentralNfe({
    preco_unitario_comercial: 43.9,
    quantidade_comercial: 1,
    quantidade_estoque: 10,
    quantidade_por_embalagem: 100,
    valor_total_embalagem: 43.9,
    custo_unitario_final: 4.39
  }), 4.39, 'quantidade efetivamente convertida prevalece sem reaplicar o fator');
  assert.equal(context.resolverCustoUnitarioCentralNfe({
    preco_unitario_comercial: 43.9,
    quantidade_comercial: 1,
    quantidade_fiscal: 1,
    quantidade_tributavel: 10,
    quantidade_por_embalagem: 10,
    valor_total_embalagem: 43.9,
    custo_unitario_final: 4.39
  }), 4.39, 'quantidade tributável convertida prevalece sobre quantidade fiscal comercial');
});

test('normalização da Central sempre usa o custo unitário canônico para calcular margem', () => {
  const start = comprasSource.indexOf('const custoMargemCentral = origemCentralNfe');
  const end = comprasSource.indexOf('const custoUnitarioPersistido', start);
  const trecho = comprasSource.slice(start, end);
  assert.match(trecho, /resolverCustoUnitarioCentralNfe\(\{\s*\.\.\.item,\s*preco_unitario:\s*custo,\s*custo_unitario_final:\s*custo\s*\}\)/);
  assert.doesNotMatch(trecho, /custo\s*>\s*0\s*\?\s*custo/);

  const sincronizacao = comprasSource.match(
    /const custoMuc = numeroPositivoCompra\(ultimaSimulacaoMucCompra\?\.custoUnitario\);[\s\S]*?const rawPreco/
  );
  assert.ok(sincronizacao, 'deve localizar o sincronismo do custo retornado pelo MUC');
  assert.match(sincronizacao[0], /draft\.preco_unitario = custoMuc;[\s\S]*?draft\.custo_unitario_final = custoMuc;/);

  const resolverStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const resolverEnd = comprasSource.indexOf('\n}\n', resolverStart) + 3;
  const context = {};
  vm.runInNewContext(
    `${comprasSource.slice(resolverStart, resolverEnd)}
    function calcularCustoNormalizado(item, custo) {
      const origemCentralNfe = true;
      ${trecho}
      return custoMargemCentral;
    }`,
    context
  );
  assert.equal(
    context.calcularCustoNormalizado({ custo_unitario_final: 43.9 }, 4.39),
    4.39,
    'custo MUC/unidade calculado substitui o custo de apresentação obsoleto'
  );
});

test('alerta Central compara custo anterior ao custo unitário normalizado', () => {
  const resolverStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const resolverEnd = comprasSource.indexOf('\n}\n', resolverStart) + 3;
  const variacaoStart = comprasSource.indexOf('function resolverVariacaoCustoEntradaCentral');
  const alertaStart = comprasSource.indexOf('function renderAlertaVariacaoCustoEntradaCentral', variacaoStart);
  const variacaoEnd = comprasSource.indexOf('\n}\n', alertaStart) + 3;
  const context = {
    isOrigemCompraCentralNfe: () => true,
    formatCurrency: (valor) => `R$ ${Number(valor).toFixed(2)}`
  };
  vm.runInNewContext(
    `${comprasSource.slice(resolverStart, resolverEnd)}
    ${comprasSource.slice(variacaoStart, variacaoEnd)}`,
    context
  );
  const itemNormalizado = {
    produto_nome: 'ARROZ POP PARB T2 1KG',
    preco_apresentacao: 43.9,
    preco_unitario: 4.39,
    preco_unitario_comercial: 43.9,
    quantidade_comercial: 100,
    quantidade_por_embalagem: 10,
    quantidade_convertida: 1000,
    custo_unitario_final: 4.39,
    custo_anterior_produto: 4.38,
    valor_total_embalagem: 4390,
    subtotal: 4390
  };
  const variacao = context.resolverVariacaoCustoEntradaCentral(itemNormalizado);

  assert.deepEqual(JSON.parse(JSON.stringify(variacao)), {
    tipo: 'aumentou',
    anterior: 4.38,
    novo: 4.39
  });
  assert.notEqual(variacao.novo, itemNormalizado.preco_apresentacao);
  const alerta = context.renderAlertaVariacaoCustoEntradaCentral(itemNormalizado);
  assert.match(alerta, /Custo anterior: R\$ 4\.38\. Novo custo: R\$ 4\.39/);
  assert.doesNotMatch(alerta, /Novo custo: R\$ 43\.90/);
});

test('alerta Central usa custos unitários e ignora preço da apresentação em todas as embalagens', () => {
  const custoStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const custoEnd = comprasSource.indexOf('\n}\n', custoStart) + 3;
  const variacaoStart = comprasSource.indexOf('function resolverVariacaoCustoEntradaCentral');
  const alertaStart = comprasSource.indexOf('function renderAlertaVariacaoCustoEntradaCentral', variacaoStart);
  const alertaEnd = comprasSource.indexOf('\n}\n', alertaStart) + 3;
  const context = {
    isOrigemCompraCentralNfe: () => true,
    formatCurrency: (valor) => `R$ ${Number(valor).toFixed(2)}`
  };
  vm.runInNewContext(
    `${comprasSource.slice(custoStart, custoEnd)}
    ${comprasSource.slice(variacaoStart, alertaEnd)}
    this.resolverAlerta = resolverCustoUnitarioCentralNfe;
    this.resolverVariacao = resolverVariacaoCustoEntradaCentral;
    this.renderAlerta = renderAlertaVariacaoCustoEntradaCentral;`,
    context
  );

  const casos = [
    {
      nome: 'UN',
      item: { custo_anterior_produto: 2, custo_unitario_final: 2.1 },
      anterior: 2,
      novo: 2.1
    },
    {
      nome: 'FARDO 100 x 10 UN',
      item: {
        custo_anterior_produto: 4.38,
        custo_unitario_final: 4.39,
        custo_unitario: 43.9,
        preco_unitario: 43.9,
        preco_apresentacao: 43.9,
        preco_unitario_comercial: 43.9,
        quantidade_comercial: 100,
        quantidade_por_embalagem: 10,
        quantidade_estoque: 1000,
        valor_total_embalagem: 4390,
        unidade_estoque: 'UN'
      },
      anterior: 4.38,
      novo: 4.39
    },
    {
      nome: 'FARDO derivado por quantidade de estoque',
      item: {
        custo_anterior_produto: 4.38,
        preco_unitario: 43.9,
        preco_apresentacao: 43.9,
        preco_unitario_comercial: 43.9,
        quantidade_comercial: 100,
        quantidade_por_embalagem: 10,
        quantidade_estoque: 1000,
        valor_total_embalagem: 4390
      },
      anterior: 4.38,
      novo: 4.39
    },
    {
      nome: 'FARDO descarta custo final obsoleto igual ao preço da apresentação',
      item: {
        custo_anterior_produto: 4.38,
        custo_unitario_final: 43.9,
        preco_unitario: 43.9,
        preco_unitario_trib: 4.39,
        preco_apresentacao: 43.9,
        preco_unitario_comercial: 43.9,
        quantidade_comercial: 100,
        quantidade_por_embalagem: 10,
        quantidade_estoque: 1000,
        valor_total_embalagem: 4390
      },
      anterior: 4.38,
      novo: 4.39
    },
    {
      nome: 'CAIXA',
      item: {
        custo_anterior_produto: 1.7,
        custo_unitario: 1.75,
        preco_unitario: 17.5,
        preco_apresentacao: 17.5,
        quantidade_comercial: 1,
        quantidade_por_embalagem: 10,
        quantidade_estoque: 10,
        valor_total_embalagem: 17.5
      },
      anterior: 1.7,
      novo: 1.75
    },
    {
      nome: 'ROLO',
      item: {
        custo_anterior_produto: 1.9,
        preco_unitario: 2,
        preco_apresentacao: 200,
        preco_unitario_comercial: 200,
        quantidade_comercial: 1,
        quantidade_por_embalagem: 100,
        quantidade_estoque: 100,
        valor_total_embalagem: 200
      },
      anterior: 1.9,
      novo: 2
    },
    {
      nome: 'sem apresentação',
      item: { custo_anterior_produto: 4.9, preco_unitario: 5 },
      anterior: 4.9,
      novo: 5
    }
  ];

  for (const caso of casos) {
    const variacao = context.resolverVariacao(caso.item);
    assert.deepEqual(JSON.parse(JSON.stringify(variacao)), {
      tipo: 'aumentou',
      anterior: caso.anterior,
      novo: caso.novo
    }, caso.nome);
    const alerta = context.renderAlerta(caso.item);
    assert.ok(alerta.includes(`Custo anterior: R$ ${caso.anterior.toFixed(2)}. Novo custo: R$ ${caso.novo.toFixed(2)}`), caso.nome);
    assert.doesNotMatch(alerta, /NaN|Infinity|undefined/, caso.nome);
  }

  assert.equal(context.resolverAlerta({
    custo_unitario_final: 2,
    custo_unitario: 3,
    preco_unitario: 4
  }), 2);
  assert.equal(context.resolverAlerta({ custo_unitario: 3, preco_unitario: 4 }), 3);
  assert.equal(context.resolverAlerta({ preco_unitario: 4 }), 4);
  assert.equal(context.renderAlerta({
    custo_anterior_produto: 'indisponível',
    custo_unitario_final: 4.39,
    preco_apresentacao: 43.9
  }), '');
  assert.equal(context.renderAlerta({ custo_anterior_produto: 4, custo_unitario_final: null }), '');
  assert.doesNotMatch(context.renderAlerta({
    custo_anterior_produto: 4.38,
    custo_unitario_final: 4.39,
    preco_apresentacao: 43.9
  }), /43\.90/);
});

test('coluna de compra Central prioriza custo canônico sem usar o preço da apresentação', () => {
  const renderStart = comprasSource.indexOf('function formatarPrecoCompraItem');
  const renderEnd = comprasSource.indexOf('\n}\n', renderStart) + 3;
  const context = {
    itemCompraEhFracionado: () => false,
    isOrigemCompraCentralNfe: () => true,
    formatCurrency: (valor) => `R$ ${Number(valor).toFixed(2)}`,
    formatarCustoUnitarioVenda: (valor) => Number(valor).toFixed(4)
  };
  const resolverStart = comprasSource.indexOf('function resolverCustoUnitarioCentralNfe');
  const resolverEnd = comprasSource.indexOf('\n}\n', resolverStart) + 3;
  vm.runInNewContext(comprasSource.slice(resolverStart, resolverEnd), context);
  vm.runInNewContext(comprasSource.slice(renderStart, renderEnd), context);

  const casos = [
    {
      nome: 'fardo',
      item: {
        quantidade_comercial: 100,
        unidade_comercial: 'FD',
        quantidade_por_embalagem: 10,
        unidade_estoque: 'UN',
        preco_apresentacao: 43.9,
        preco_unitario_comercial: 43.9,
        quantidade_estoque: 1000,
        custo_unitario_final: 43.9,
        preco_unitario: 43.9,
        preco_unitario_trib: 4.39,
        valor_total_embalagem: 4390
      },
      esperado: 'R$ 4.39'
    },
    {
      nome: 'rolo',
      item: {
        quantidade_comercial: 1,
        unidade_comercial: 'ROLO',
        quantidade_por_embalagem: 100,
        unidade_estoque: 'MT',
        preco_apresentacao: 200,
        quantidade_estoque: 100,
        custo_unitario_final: 2,
        preco_unitario: 200
      },
      esperado: 'R$ 2.00'
    },
    {
      nome: 'caixa',
      item: {
        quantidade_comercial: 1,
        unidade_comercial: 'CX',
        quantidade_por_embalagem: 12,
        unidade_estoque: 'UN',
        preco_apresentacao: 120,
        quantidade_estoque: 12,
        custo_unitario_final: 10,
        preco_unitario: 120
      },
      esperado: 'R$ 10.00'
    },
    {
      nome: 'unidade',
      item: {
        quantidade_comercial: 1,
        unidade_comercial: 'UN',
        quantidade_por_embalagem: 1,
        unidade_estoque: 'UN',
        preco_unitario: 5,
        preco_apresentacao: 5,
        quantidade_estoque: 1
      },
      esperado: 'R$ 5.00'
    }
  ];
  for (const caso of casos) {
    assert.equal(context.formatarPrecoCompraItem(caso.item), caso.esperado, caso.nome);
  }
  assert.equal(context.formatarPrecoCompraItem({
    custo_unitario: 3.25,
    preco_unitario: 8,
    custo_unitario_final: 2.5
  }), 'R$ 2.50', 'custo_unitario_final prevalece sobre os demais valores');
  assert.equal(context.formatarPrecoCompraItem({
    custo_unitario: 3.25,
    preco_unitario: 8
  }), 'R$ 3.25', 'custo_unitario prevalece sobre preco_unitario');
  assert.equal(context.formatarPrecoCompraItem({
    quantidade_comercial: 100,
    quantidade_por_embalagem: 10,
    preco_apresentacao: 43.9,
    preco_unitario_comercial: 43.9,
    quantidade_estoque: 1000,
    custo_unitario_final: 43.9,
    preco_unitario: 43.9,
    preco_unitario_trib: 4.39,
    valor_total_embalagem: 4390
  }), 'R$ 4.39', 'coluna mostra o custo unitário tributável e não o preço do fardo');
});
