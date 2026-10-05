'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const comprasSource = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/compras.js'),
  'utf8'
);

function extrairFuncao(nome) {
  const start = comprasSource.indexOf(`function ${nome}(`);
  assert.notEqual(start, -1, `função ${nome} deve existir`);
  const end = comprasSource.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `fim da função ${nome} deve existir`);
  return comprasSource.slice(start, end + 3);
}

const FUNCOES_CENTRAL = [
  'normalizarPrecoVendaCentral',
  'precoVendaCentralFoiAlterado',
  'calcularMargemBrutaCentralNfe',
  'resolverCustoUnitarioCentralNfe',
  'resolverSubtotalCentralNfe',
  'resolverVariacaoCustoEntradaCentral',
  'renderAlertaVariacaoCustoEntradaCentral',
  'formatarPrecoCompraItem',
  'renderResumoConversaoItemCompraHtml',
  'resolverSnapshotEmbalagemEdicaoCentral',
  'renderItensCompraTabelaCore',
  'alterarPrecoVendaItemCompra'
];

function criarContexto(itens = []) {
  const margemEl = { textContent: '' };
  const contexto = {
    isOrigemCompraCentralNfe: () => true,
    diagnosticarEstadoMargemCentralNfe: () => {},
    produtosCompraList: [{ id: 1, nome: 'Produto Central' }],
    indiceEditandoCompra: null,
    itemDraftCompra: null,
    itensCompraAtual: itens,
    indiceProximoDestaqueCompra: null,
    formatarQuantidadeItemCompra: () => '',
    itemCompraEhFracionado: () => false,
    obterQuantidadeComercialItemCompra: (item) => Number(item.quantidade_comercial ?? item.quantidade ?? 0),
    obterQuantidadeConvertidaItemCompra: (item) => Number(item.quantidade_convertida ?? item.quantidade_estoque ?? item.quantidade ?? 0),
    formatNumberInput: (valor, casas = 2) => Number(valor || 0).toFixed(casas),
    formatCurrency: (valor) => `R$ ${Number(valor || 0).toFixed(2)}`,
    formatarCustoUnitarioVenda: (valor) => Number(valor || 0).toFixed(4),
    formatQuantidadeExibicao: (valor) => String(Number(valor)),
    rotuloTipoEmbalagemCompra: (valor) => String(valor),
    renderCfopColunaItemCompra: () => '5102',
    renderMiipSugestaoCard: () => '',
    escapeHtml: (valor) => String(valor ?? ''),
    recalcularTotaisCompraNota: () => {},
    atualizarItemCompraImutavel: (index, atualizar) => {
      const item = { ...contexto.itensCompraAtual[index] };
      atualizar(item);
      contexto.itensCompraAtual[index] = item;
    },
    focarCampoPrecoVendaItemCompra: () => {},
    document: { querySelector: () => margemEl },
    margemEl
  };
  contexto.$ = () => ({ html: (html) => { contexto.html = html; } });
  vm.runInNewContext(FUNCOES_CENTRAL.map(extrairFuncao).join('\n'), contexto);
  return contexto;
}

const CASOS = [
  {
    nome: 'FARDO',
    venda: 5.92,
    base: {
      quantidade_comercial: 100,
      quantidade_embalagens: 100,
      unidade_comercial: 'FD',
      compra_em: 'FD',
      quantidade_por_embalagem: 10,
      fator_conversao: 10,
      preco_unitario_comercial: 43.9,
      preco_apresentacao: 43.9,
      valor_total_embalagem: 4390,
      quantidade_convertida: 1000,
      quantidade_estoque: 1000,
      unidade_estoque: 'UN',
      unidade: 'UN'
    },
    precoApresentacao: 43.9,
    quantidade: 1000,
    total: 4390,
    custo: 4.39,
    margem: '25.84',
    formatosExtras: {
      'qTrib/vUnTrib na unidade comercial': {
        quantidade_comercial: 100,
        unidade_comercial: 'FD',
        unidade_tributavel: 'FD',
        quantidade_tributavel: 100,
        preco_unitario_trib: 43.9,
        quantidade_por_embalagem: 10,
        preco_unitario_comercial: 43.9,
        preco_unitario: 43.9,
        valor_total_embalagem: 4390,
        unidade: 'UN'
      }
    }
  },
  {
    nome: 'ROLO',
    venda: 1.5,
    base: {
      quantidade_comercial: 1,
      quantidade_embalagens: 1,
      unidade_comercial: 'ROLO',
      compra_em: 'ROLO',
      quantidade_por_embalagem: 100,
      fator_conversao: 100,
      preco_unitario_comercial: 100,
      preco_apresentacao: 100,
      valor_total_embalagem: 100,
      quantidade_convertida: 100,
      quantidade_estoque: 100,
      unidade_estoque: 'MT',
      unidade: 'MT'
    },
    precoApresentacao: 100,
    quantidade: 100,
    total: 100,
    custo: 1,
    margem: '33.33'
  },
  {
    nome: 'CAIXA',
    venda: 12.5,
    base: {
      quantidade_comercial: 10,
      quantidade_embalagens: 10,
      unidade_comercial: 'CX',
      compra_em: 'CX',
      quantidade_por_embalagem: 12,
      fator_conversao: 12,
      preco_unitario_comercial: 120,
      preco_apresentacao: 120,
      valor_total_embalagem: 1200,
      quantidade_convertida: 120,
      quantidade_estoque: 120,
      unidade_estoque: 'UN',
      unidade: 'UN'
    },
    precoApresentacao: 120,
    quantidade: 120,
    total: 1200,
    custo: 10,
    margem: '20.00'
  },
  {
    nome: 'UN',
    venda: 6,
    base: {
      quantidade_comercial: 20,
      unidade_comercial: 'UN',
      preco_unitario_comercial: 5,
      valor_total_embalagem: 100,
      quantidade_convertida: 20,
      quantidade_estoque: 20,
      unidade_estoque: 'UN',
      unidade: 'UN'
    },
    precoApresentacao: 5,
    quantidade: 20,
    total: 100,
    custo: 5,
    margem: '16.67'
  }
];

function formatosDoCaso(caso) {
  return {
    importado: { ...caso.base, preco_unitario: caso.precoApresentacao },
    'custo obsoleto igual ao preço da apresentação': {
      ...caso.base,
      preco_unitario: caso.precoApresentacao,
      custo_unitario: caso.precoApresentacao,
      custo_unitario_final: caso.precoApresentacao
    },
    normalizado: {
      ...caso.base,
      preco_unitario: caso.custo,
      custo_unitario: caso.custo,
      custo_unitario_final: caso.custo
    },
    ...(caso.formatosExtras || {})
  };
}

for (const caso of CASOS) {
  test(`custo canônico Central — ${caso.nome}: quantidade, custo, margem e subtotal`, () => {
    const contexto = criarContexto();
    for (const [formato, item] of Object.entries(formatosDoCaso(caso))) {
      const rotulo = `${caso.nome} (${formato})`;
      const custo = contexto.resolverCustoUnitarioCentralNfe(item);
      assert.equal(Number(custo.toFixed(4)), caso.custo, `${rotulo}: custo unitário`);
      if (caso.precoApresentacao !== caso.custo) {
        assert.notEqual(custo, caso.precoApresentacao, `${rotulo}: preço da apresentação não é custo`);
      }
      assert.equal(
        contexto.calcularMargemBrutaCentralNfe(custo, caso.venda).toFixed(2),
        caso.margem,
        `${rotulo}: margem bruta`
      );
    }
    const normalizado = formatosDoCaso(caso).normalizado;
    assert.equal(caso.base.quantidade_estoque, caso.quantidade, `${caso.nome}: quantidade de estoque`);
    assert.equal(contexto.resolverSubtotalCentralNfe(normalizado), caso.total, `${caso.nome}: subtotal`);
    assert.equal(
      Number((caso.quantidade * caso.custo).toFixed(2)),
      caso.total,
      `${caso.nome}: subtotal = quantidade convertida × custo unitário`
    );
  });
}

test('UN direta não aplica fator inexistente', () => {
  const contexto = criarContexto();
  const item = { quantidade_comercial: 20, quantidade: 20, unidade: 'UN', preco_unitario: 5 };
  assert.equal(contexto.resolverCustoUnitarioCentralNfe(item), 5);
  assert.equal(contexto.resolverSubtotalCentralNfe(item), 100);
});

test('consistência: coluna, margem, subtotal, resumo, alerta e edição usam o mesmo custo canônico', () => {
  for (const caso of CASOS) {
    for (const [formato, base] of Object.entries(formatosDoCaso(caso))) {
      const rotulo = `${caso.nome} (${formato})`;
      const item = { ...base, custo_anterior_produto: 0.01 };
      const contexto = criarContexto();
      const custo = contexto.resolverCustoUnitarioCentralNfe(item);

      assert.equal(contexto.formatarPrecoCompraItem(item), `R$ ${custo.toFixed(2)}`, `${rotulo}: coluna`);
      assert.equal(contexto.resolverVariacaoCustoEntradaCentral(item).novo, custo, `${rotulo}: alerta`);
      const quantidade = Number(item.quantidade_estoque ?? item.quantidade_convertida ?? item.quantidade_tributavel);
      assert.equal(
        contexto.resolverSubtotalCentralNfe(item),
        Number((quantidade * custo).toFixed(2)),
        `${rotulo}: subtotal`
      );
      const snapshot = contexto.resolverSnapshotEmbalagemEdicaoCentral(item);
      if (snapshot) assert.equal(snapshot.custoUnitario, custo, `${rotulo}: edição`);
      const resumo = contexto.renderResumoConversaoItemCompraHtml(item);
      if (resumo) {
        assert.ok(
          resumo.includes(`Custo unitário:</strong> R$ ${custo.toFixed(4)}`),
          `${rotulo}: resumo da conversão`
        );
      }
    }
  }
});

test('tabela Central renderiza coluna, margem, subtotal, resumo e alerta com o mesmo custo e recalcula margem só quando o preço é editado', () => {
  const item = {
    ...formatosDoCaso(CASOS[0])['custo obsoleto igual ao preço da apresentação'],
    produto_id: 1,
    produto_nome: 'ARROZ POP PARB T2 1KG',
    custo_anterior_produto: 4.38,
    precoVendaOriginal: 5.92,
    precoVendaAtual: 5.92,
    subtotal: 4390
  };
  const contexto = criarContexto([item]);
  contexto.renderItensCompraTabelaCore();
  const html = contexto.html;

  assert.match(html, /<td style="min-width:110px;">\s*R\$ 4\.39/, 'coluna Valor unitário de compra');
  assert.match(html, /data-margem-bruta-item="0">25\.84%<\/span>/, 'margem bruta');
  assert.match(html, /<td>R\$ 4390\.00<\/td>/, 'subtotal');
  assert.match(html, /Custo unitário:<\/strong> R\$ 4\.3900/, 'resumo da conversão');
  assert.match(html, /Custo anterior: R\$ 4\.38\. Novo custo: R\$ 4\.39/, 'alerta');
  assert.match(html, /O preço de venda não foi alterado automaticamente/);
  assert.doesNotMatch(html, /R\$ 43\.90<|Novo custo: R\$ 43\.90|R\$ 43900\.00|-641\.55%/);
  assert.match(html, /data-preco-venda-item="0"[\s\S]*?value="5\.92"/, 'preço de venda existente');
  assert.equal(contexto.itensCompraAtual[0].precoVendaAtual, 5.92);
  assert.equal(contexto.itensCompraAtual[0].precoVendaOriginal, 5.92);
  assert.equal(contexto.itensCompraAtual[0].preco_venda, undefined);

  contexto.alterarPrecoVendaItemCompra(0, '6.00');
  assert.equal(contexto.margemEl.textContent, '26.83%');
  assert.equal(Number(contexto.itensCompraAtual[0].margem_lucro.toFixed(2)), 26.83);
  assert.equal(contexto.itensCompraAtual[0].precoVendaAtual, 6);
  assert.equal(contexto.itensCompraAtual[0].precoVendaOriginal, 5.92);
  assert.equal(contexto.itensCompraAtual[0].precoVendaAlteradoManualmente, true);
  contexto.renderItensCompraTabelaCore();
  assert.match(contexto.html, /data-margem-bruta-item="0">26\.83%<\/span>/);
  assert.match(contexto.html, /<td>R\$ 4390\.00<\/td>/);
  assert.match(contexto.html, /<td style="min-width:110px;">\s*R\$ 4\.39/);
});

test('fonte única: nenhuma outra função da Central calcula custo unitário por conta própria', () => {
  const resolvedoresCusto = comprasSource.match(/function resolverCusto\w*CentralNfe\w*\(/g) || [];
  assert.deepEqual(resolvedoresCusto, ['function resolverCustoUnitarioCentralNfe(']);
  assert.doesNotMatch(comprasSource, /resolverCustoMargemCentralNfe|resolverCustoUnitarioAlertaCentralNfe/);

  const consumidores = [
    'formatarPrecoCompraItem',
    'resolverSubtotalCentralNfe',
    'resolverVariacaoCustoEntradaCentral',
    'renderResumoConversaoItemCompraHtml',
    'restaurarResumoConversaoMucEdicaoCentral',
    'resolverSnapshotEmbalagemEdicaoCentral',
    'alterarPrecoVendaItemCompra',
    'renderItensCompraTabelaCore',
    'normalizeItemCompra',
    'enriquecerApresentacoesItensCentralCompra'
  ];
  for (const nome of consumidores) {
    assert.match(extrairFuncao(nome), /resolverCustoUnitarioCentralNfe\(/, `${nome} deve consumir a fonte única`);
  }

  for (const nome of [
    'resolverSubtotalCentralNfe',
    'resolverVariacaoCustoEntradaCentral',
    'restaurarResumoConversaoMucEdicaoCentral',
    'resolverSnapshotEmbalagemEdicaoCentral'
  ]) {
    assert.doesNotMatch(
      extrairFuncao(nome),
      /\.(custo_unitario\w*|preco_unitario_trib|preco_unitario_tributavel|preco_apresentacao|custo_por_kg)\b/,
      `${nome} não deve ler campos de custo diretamente`
    );
  }

  const render = extrairFuncao('renderItensCompraTabelaCore');
  assert.match(render, /formatarPrecoCompraItem\(itemMargemCentral\)/);
  assert.match(render, /renderAlertaVariacaoCustoEntradaCentral\(itemMargemCentral\)/);
  assert.match(render, /renderResumoConversaoItemCompraHtml\(itemMargemCentral\)/);
  assert.match(render, /resolverSubtotalCentralNfe\(itemMargemCentral\)/);
  assert.match(render, /calcularMargemBrutaCentralNfe\(\s*resolverCustoUnitarioCentralNfe\(itemMargemCentral\)/);
});
