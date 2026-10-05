/**
 * CORREÇÃO-NF-MARGEM-01 — Percentual NF = lucro_percentual do produto vinculado.
 * Executar: node --test tests/compras/correcao-nf-margem-01.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const mapperJs = fs.readFileSync(
  path.join(ROOT, 'backend/shared/nfe/mappers/nfeXmlMapper.js'),
  'utf8'
);
const dtoJs = fs.readFileSync(
  path.join(ROOT, 'backend/shared/nfe/contracts/NfeItemParseadoDTO.js'),
  'utf8'
);

const MARGEM_PADRAO_FALLBACK_COMPRA = 35;

function extrairMargemCadastradaProduto(produto) {
  if (!produto || typeof produto !== 'object') {
    return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: 'padrao' };
  }
  const candidatos = [
    produto.lucro_percentual,
    produto.margem_lucro,
    produto.margem_padrao,
    produto.percentual_lucro
  ];
  for (const raw of candidatos) {
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return { margem: n, fallback: false, origem: 'cadastro' };
    }
  }
  return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: 'padrao' };
}

function itemCompraTemMargemGravada(item) {
  if (!item) return false;
  const raw = item.margem_lucro;
  if (raw === undefined || raw === null || raw === '') return false;
  return Number.isFinite(Number(raw));
}

function deveReaplicarMargemCadastroItemCompra(item, compraImportadaXml) {
  if (!item || !item.produto_id) return false;
  if (Number(item.margem_editada_manual) === 1) return false;
  if (item.margem_origem === 'manual') return false;
  if (!itemCompraTemMargemGravada(item)) return true;
  if (item.margem_origem === 'xml_default') return true;
  if (compraImportadaXml) {
    if (item.margem_origem !== 'cadastro' && item.margem_origem !== 'fallback') {
      return true;
    }
  }
  return false;
}

function resolverMargemItem(item, produto, compraImportadaXml) {
  if (deveReaplicarMargemCadastroItemCompra(item, compraImportadaXml)) {
    return extrairMargemCadastradaProduto(produto);
  }
  if (itemCompraTemMargemGravada(item)) {
    return { margem: Number(item.margem_lucro), fallback: false, origem: 'item' };
  }
  return extrairMargemCadastradaProduto(produto);
}

describe('CORREÇÃO-NF-MARGEM-01 — parser sem default 30', () => {
  it('nfeXmlMapper não injeta margem_lucro: 30', () => {
    assert.doesNotMatch(mapperJs, /margem_lucro:\s*30/);
    assert.match(mapperJs, /margem_lucro:\s*null/);
  });

  it('NfeItemParseadoDTO não defaulta margem para 30', () => {
    assert.doesNotMatch(dtoJs, /margem_lucro\s*\?\?\s*30/);
    assert.doesNotMatch(dtoJs, /margemLucro\s*\?\?\s*dados\.margem_lucro\s*\?\?\s*30/);
    assert.match(dtoJs, /margemLucro = null/);
  });

  it('DTO não fabrica preco_venda_sugerido = custo * 1.3', () => {
    assert.doesNotMatch(dtoJs, /\*\s*1\.3/);
  });
});

describe('CORREÇÃO-NF-MARGEM-01 — precedência do cadastro', () => {
  it('Central ignora flags antigos e preserva preço e margem bruta cadastrados', () => {
    const match = comprasJs.match(/function aplicarPoliticaPrecoVendaCentral\([\s\S]*?\n\}/);
    const margem = comprasJs.match(/function calcularMargemBrutaCentralNfe\([\s\S]*?\n\}/);
    const custoUnitario = comprasJs.match(/function resolverCustoUnitarioCentralNfe\([\s\S]*?\n\}/);
    const custoMargem = comprasJs.match(/function resolverCustoMargemCentralNfe\([\s\S]*?\n\}/);
    const subtotalCentral = comprasJs.match(/function resolverSubtotalCentralNfe\([\s\S]*?\n\}/);
    const normalizador = comprasJs.match(/function normalizarPrecoVendaCentral\([\s\S]*?\n\}/);
    const comparador = comprasJs.match(/function precoVendaCentralFoiAlterado\([\s\S]*?\n\}/);
    assert.ok(match, 'política de preço Central deve existir');
    assert.ok(margem && custoUnitario && normalizador && comparador, 'helpers de preço Central devem existir');
    const contexto = { isOrigemCompraCentralNfe: () => true };
    vm.runInNewContext(
      `${normalizador[0]}\n${comparador[0]}\n${margem[0]}\n${custoUnitario[0]}\n${match[0]}\nthis.aplicar = aplicarPoliticaPrecoVendaCentral;`,
      contexto
    );

    const existente = {
      precoVendaOriginal: 15,
      precoVendaAtual: 15,
      atualizar_preco_venda: 1
    };
    contexto.aplicar(existente, { preco_venda: 15 });
    assert.equal(existente.precoVendaOriginal, 15);
    assert.equal(existente.precoVendaAtual, 15);
    assert.equal(existente.precoVendaAlteradoManualmente, false);
    assert.equal(existente.atualizar_preco_venda, undefined);

    const manual = {
      precoVendaOriginal: 15,
      precoVendaAtual: 18,
      precoVendaAlteradoManualmente: true,
      margem_origem: 'manual',
      margem_editada_manual: 1,
      atualizar_preco_venda: 1,
      atualizar_preco_venda_editado_manual: 1,
      preco_unitario: 1.75
    };
    contexto.aplicar(manual, { preco_venda: 15 });
    assert.equal(manual.precoVendaAtual, 18);
    assert.equal(manual.precoVendaAlteradoManualmente, true);
    assert.equal(Number(manual.margem_lucro.toFixed(2)), 90.28);
    assert.equal(manual.atualizar_preco_venda, undefined);
    assert.equal(manual.atualizar_preco_venda_editado_manual, undefined);
  });

  it('Central não mostra venda sugerida, checkbox nem origem de margem cadastrada', () => {
    assert.doesNotMatch(comprasJs, /Venda sugerida/i);
    assert.match(comprasJs, /data-preco-venda-item="\$\{index\}"/);
    assert.match(comprasJs, /data-margem-bruta-item="\$\{index\}"/);
    assert.match(comprasJs, /isOrigemCompraCentralNfe\(\) \? 'Margem bruta'/);
    assert.match(comprasJs, /isOrigemCompraCentralNfe\(\) \? 'Preço de venda'/);
    assert.match(comprasJs, /\.\.\.\(origemCentralNfe \? \{\} : \{ atualizar_preco_venda: Number/);
    assert.match(comprasJs, /\.\.\.\(isOrigemCompraCentralNfe\(\) \? \{\s*precoVendaOriginal:/);
    assert.match(comprasJs, /'<output class="form-control bg-light" id="margem_padrao_item"/);
    assert.doesNotMatch(
      comprasJs,
      /<input[^>]*id="margem_padrao_item"[^>]*\$\{isOrigemCompraCentralNfe\(\)/
    );
  });

  it('abre a Central com origem definida antes de renderizar os campos do modal', () => {
    const abrir = comprasJs.match(/function abrirCompraDesdeCentralEntradas\(payload\) \{[\s\S]*?\n\}/);
    const show = comprasJs.match(/function showCompraModal\(opcoes = \{\}\) \{[\s\S]*?const modalHtml =/);
    const resolverOrigem = comprasJs.match(/function isOrigemCompraCentralNfe\(\) \{[\s\S]*?\n\}/);
    assert.ok(abrir, 'handler de abertura pela Central deve existir');
    assert.ok(show, 'modal de compra deve aceitar origem antes do render');
    assert.ok(resolverOrigem, 'origem Central deve ser resolvida pelo contexto da importação');
    assert.match(show[0], /origemCompraAtual = opcoes\.origem === ORIGEM_COMPRA\.CENTRAL_NFE[\s\S]*?const modalHtml =/);

    const contexto = {
      ORIGEM_COMPRA: { MANUAL: 'MANUAL', CENTRAL_NFE: 'CENTRAL_NFE' },
      clonarDadosItemCompra: (payload) => payload,
      showCompraModal: (opcoes) => { contexto.origemRenderizada = opcoes.origem; },
      finalizarImportacaoXmlCompra: (_data, origem) => { contexto.origemNoPayload = origem; }
    };
    vm.runInNewContext(`${abrir[0]}`, contexto);
    contexto.abrirCompraDesdeCentralEntradas({
      documentoId: 42,
      dadosCompra: { itens: [] }
    });
    assert.equal(contexto.origemRenderizada, 'CENTRAL_NFE');
    assert.equal(contexto.origemNoPayload, 'CENTRAL_NFE');

    const contextoOrigem = {
      origemCompraAtual: 'MANUAL',
      ORIGEM_COMPRA: { MANUAL: 'MANUAL', CENTRAL_NFE: 'CENTRAL_NFE' },
      compraImportadaXml: { origem_compra: 'CENTRAL_NFE' }
    };
    vm.runInNewContext(`${resolverOrigem[0]}`, contextoOrigem);
    assert.equal(contextoOrigem.isOrigemCompraCentralNfe(), true);
    contextoOrigem.compraImportadaXml = { origem_compra: 'MANUAL' };
    assert.equal(contextoOrigem.isOrigemCompraCentralNfe(), false);
  });

  it('permite editar preço na Central e exibe a margem como informação', () => {
    const render = comprasJs.match(/function renderItensCompraTabelaCore\(\) \{[\s\S]*?\n\}/);
    assert.ok(render, 'render da tabela de compras deve existir');

    function renderizarTabela(origemCentral) {
      const contexto = {
        isOrigemCompraCentralNfe: () => origemCentral,
        indiceEditandoCompra: null,
        itemDraftCompra: null,
        produtosCompraList: [{ id: 1, nome: 'Produto teste' }],
        itensCompraAtual: [{
          produto_id: 1,
          produto_nome: 'Produto teste',
          preco_unitario: 10,
          precoVendaOriginal: 15,
          precoVendaAtual: 15,
          preco_venda_sugerido: 15,
          margem_lucro: 33.33,
          subtotal: 10
        }],
        indiceProximoDestaqueCompra: null,
        $: () => ({ html: (html) => { contexto.html = html; } }),
        formatarQuantidadeItemCompra: () => '1 UN',
        renderResumoConversaoItemCompraHtml: () => '',
        formatarPrecoCompraItem: () => 'R$ 10,00',
        formatQuantidadeExibicao: (valor) => String(Number(valor)),
        renderAlertaVariacaoCustoEntradaCentral: () => '',
        resolverSubtotalCentralNfe: (item) => item.subtotal,
        itemCompraEhFracionado: () => false,
        formatNumberInput: (valor, decimals = 2) => Number(valor).toFixed(decimals),
        formatCurrency: (valor) => `R$ ${Number(valor).toFixed(2)}`,
        normalizarPrecoVendaCentral: (valor) => valor == null ? null : Number(valor),
        diagnosticarEstadoMargemCentralNfe: () => {},
        resolverCustoUnitarioCentralNfe: (item) => Number(item.preco_unitario || 0),
        resolverCustoMargemCentralNfe: (item) => Number(item.custo_unitario_final ?? item.custo_unitario ?? item.preco_unitario ?? 0),
        calcularMargemBrutaCentralNfe: (custo, venda) =>
          Number(venda) > 0 ? ((Number(venda) - Number(custo)) / Number(venda)) * 100 : null,
        renderCfopColunaItemCompra: () => '5102',
        renderMiipSugestaoCard: () => '',
        escapeHtml: (valor) => String(valor),
        recalcularTotaisCompraNota: () => {}
      };
      vm.runInNewContext(`${render[0]}`, contexto);
      contexto.renderItensCompraTabelaCore();
      return contexto.html;
    }

    const centralHtml = renderizarTabela(true);
    assert.match(centralHtml, /value="Produto teste" readonly aria-label="Produto \/ descrição"/);
    assert.match(centralHtml, /data-preco-venda-item="0"/);
    assert.match(centralHtml, /data-margem-bruta-item="0"/);
    assert.match(centralHtml, /oninput="alterarPrecoVendaItemCompra\(0, this\.value\)"/);
    assert.doesNotMatch(centralHtml, /<input[^>]*data-margem-bruta-item/);
    assert.match(centralHtml, /<span data-margem-bruta-item="0">33\.33%<\/span>/);
    assert.doesNotMatch(centralHtml, /Atualizar preço|type="checkbox"/);

    const compraComumHtml = renderizarTabela(false);
    assert.match(compraComumHtml, /onchange="alterarProdutoItemCompra\(0, this\.value\)"/);
    assert.match(compraComumHtml, /Atualizar preço/);
    assert.match(compraComumHtml, /data-preco-venda-item/);
  });

  it('renderização real da Central substitui markup legado por margem bruta e atualiza ao digitar', () => {
    const render = comprasJs.match(/function renderItensCompraTabelaCore\(\) \{[\s\S]*?\n\}/);
    const margem = comprasJs.match(/function calcularMargemBrutaCentralNfe\([\s\S]*?\n\}/);
    const custoUnitario = comprasJs.match(/function resolverCustoUnitarioCentralNfe\([\s\S]*?\n\}/);
    const subtotalCentral = comprasJs.match(/function resolverSubtotalCentralNfe\([\s\S]*?\n\}/);
    const precoCompra = comprasJs.match(/function formatarPrecoCompraItem\([\s\S]*?\n\}/);
    const variacaoCusto = comprasJs.match(/function resolverVariacaoCustoEntradaCentral\([\s\S]*?\n\}/);
    const alertaCusto = comprasJs.match(/function renderAlertaVariacaoCustoEntradaCentral\([\s\S]*?\n\}/);
    const normalizador = comprasJs.match(/function normalizarPrecoVendaCentral\([\s\S]*?\n\}/);
    const comparador = comprasJs.match(/function precoVendaCentralFoiAlterado\([\s\S]*?\n\}/);
    const handler = comprasJs.match(/function alterarPrecoVendaItemCompra\([\s\S]*?\n\}/);
    assert.ok(render && margem && custoUnitario && subtotalCentral && precoCompra && variacaoCusto && alertaCusto && normalizador && comparador && handler);

    const margemEl = { textContent: '' };
    const contexto = {
      isOrigemCompraCentralNfe: () => true,
      diagnosticarEstadoMargemCentralNfe: () => {},
      origem_compra: 'CENTRAL_NFE',
      produtosCompraList: [{ id: 1, nome: 'Produto Central', preco_venda: 2.43 }],
      indiceEditandoCompra: null,
      itemDraftCompra: null,
      itensCompraAtual: [{
        produto_id: 1,
        produto_nome: 'Produto Central',
        preco_unitario: 43.9,
        custo_unitario_final: 4.39,
        custo_anterior_produto: 4.38,
        preco_unitario_comercial: 43.9,
        preco_apresentacao: 43.9,
        quantidade_comercial: 100,
        quantidade_convertida: 1000,
        quantidade_estoque: 1000,
        quantidade_por_embalagem: 10,
        unidade_comercial: 'FD',
        unidade_apresentacao: 'FD',
        unidade_estoque: 'UN',
        valor_total_embalagem: 4390,
        precoVendaOriginal: 5.92,
        precoVendaAtual: 5.92,
        margem_lucro: 35,
        subtotal: 4390
      }],
      indiceProximoDestaqueCompra: null,
      formatarQuantidadeItemCompra: () => '1 FD<br>(10 UN)',
      renderResumoConversaoItemCompraHtml: () => '',
      itemCompraEhFracionado: () => false,
      formatNumberInput: (valor) => Number(valor).toFixed(2),
      formatCurrency: (valor) => `R$ ${Number(valor).toFixed(2)}`,
      formatarCustoUnitarioVenda: (valor) => Number(valor).toFixed(4),
      formatQuantidadeExibicao: (valor) => String(Number(valor)),
      rotuloTipoEmbalagemCompra: (unidade) => String(unidade),
      renderCfopColunaItemCompra: () => '5102',
      renderMiipSugestaoCard: () => '',
      escapeHtml: (valor) => String(valor),
      recalcularTotaisCompraNota: () => {},
      atualizarItemCompraImutavel: (index, atualizar) => {
        const item = { ...contexto.itensCompraAtual[index] };
        atualizar(item);
        contexto.itensCompraAtual[index] = item;
      },
      document: { querySelector: () => margemEl },
      focarCampoPrecoVendaItemCompra: () => {}
    };
    contexto.$ = () => ({
      html: (html) => {
        contexto.html = html;
        margemEl.textContent = html.match(/data-margem-bruta-item="0">([^<]*)</)?.[1] || '';
      }
    });
    vm.runInNewContext(
      `${normalizador[0]}\n${comparador[0]}\n${margem[0]}\n${custoUnitario[0]}\n${subtotalCentral[0]}\n${variacaoCusto[0]}\n${alertaCusto[0]}\n${precoCompra[0]}\n${render[0]}\n${handler[0]}`,
      contexto
    );

    contexto.renderItensCompraTabelaCore();
    assert.match(contexto.html, /data-margem-bruta-item="0">25\.84%<\/span>/);
    assert.match(contexto.html, /<td>R\$ 4390\.00<\/td>/);
    assert.match(contexto.html, /<td style="min-width:110px;">\s*R\$ 4\.39/);
    assert.doesNotMatch(contexto.html, /Preço da apresentação/);
    assert.match(contexto.html, /Custo anterior: R\$ 4\.38\. Novo custo: R\$ 4\.39/);
    assert.doesNotMatch(contexto.html, /-641\.55%/);
    assert.doesNotMatch(contexto.html, /Novo custo: R\$ 43\.90/);
    assert.doesNotMatch(contexto.html, /Atualizar preço|type="checkbox"/);
    assert.match(contexto.html, /data-preco-venda-item="0"[^>]*value="5\.92"/);

    contexto.itemDraftCompra = null;
    contexto.indiceEditandoCompra = null;
    contexto.itensCompraAtual[0].preco_unitario_trib = 4.39;
    contexto.itensCompraAtual[0].custo_unitario_final = 4.39;
    contexto.itensCompraAtual[0].unidade_comercial = 'FD';
    contexto.itensCompraAtual[0].unidade_tributavel = 'UN';
    contexto.itensCompraAtual[0].quantidade_comercial = 100;
    contexto.itensCompraAtual[0].quantidade_estoque = 0;
    contexto.itensCompraAtual[0].quantidade_convertida = 0;
    contexto.itensCompraAtual[0].quantidade_tributavel = 0;
    contexto.renderItensCompraTabelaCore();
    assert.match(contexto.html, /data-margem-bruta-item="0">25\.84%<\/span>/);
    assert.match(contexto.html, /Custo anterior: R\$ 4\.38\. Novo custo: R\$ 4\.39/);
    assert.doesNotMatch(contexto.html, /-641\.55%|Novo custo: R\$ 43\.90/);

    contexto.itensCompraAtual[0].quantidade_estoque = 1000;
    contexto.itensCompraAtual[0].quantidade_convertida = 1000;
    contexto.itensCompraAtual[0].quantidade_tributavel = 1000;
    contexto.alterarPrecoVendaItemCompra(0, '6.00');
    assert.equal(margemEl.textContent, '26.83%');
    assert.equal(contexto.itensCompraAtual[0].precoVendaAlteradoManualmente, true);
    assert.equal(Number(contexto.itensCompraAtual[0].margem_lucro.toFixed(2)), 26.83);
    assert.equal(contexto.itensCompraAtual[0].custo_unitario_final, 4.39);
    assert.equal(contexto.itensCompraAtual[0].subtotal, 4390);
    contexto.renderItensCompraTabelaCore();
    assert.match(contexto.html, /<td>R\$ 4390\.00<\/td>/);

    contexto.alterarPrecoVendaItemCompra(0, '7.00');
    assert.equal(margemEl.textContent, '37.29%');
    assert.equal(contexto.itensCompraAtual[0].custo_unitario_final, 4.39);
    assert.equal(contexto.itensCompraAtual[0].subtotal, 4390);
    contexto.renderItensCompraTabelaCore();
    assert.match(contexto.html, /data-margem-bruta-item="0">37\.29%<\/span>/);
    assert.match(contexto.html, /<td>R\$ 4390\.00<\/td>/);
    assert.doesNotMatch(contexto.html, /Atualizar preço|type="checkbox"/);
  });

  it('seleção do produto e edição no formulário Central exibem margem bruta em tempo real', async () => {
    const aplicarDados = comprasJs.match(/async function aplicarDadosComerciaisProdutoFormularioCompra\([\s\S]*?\n\}/);
    const marcarPreco = comprasJs.match(/function marcarPrecoVendaManualCompra\(\) \{[\s\S]*?\n\}/);
    const margem = comprasJs.match(/function calcularMargemBrutaCentralNfe\([\s\S]*?\n\}/);
    const normalizador = comprasJs.match(/function normalizarPrecoVendaCentral\([\s\S]*?\n\}/);
    const comparador = comprasJs.match(/function precoVendaCentralFoiAlterado\([\s\S]*?\n\}/);
    const atualizarExibicao = comprasJs.match(/function atualizarExibicaoMargemCompra\([\s\S]*?\n\}/);
    assert.ok(aplicarDados && marcarPreco && margem && normalizador && comparador && atualizarExibicao);

    const campos = {
      '#preco_item': '',
      '#preco_venda_item': '',
      '#margem_padrao_item': ''
    };
    const draft = { preco_unitario: 1.8, precoVendaOriginal: 2.43, precoVendaAtual: 2.43 };
    const contexto = {
      itemDraftCompra: draft,
      linhaIdEditandoCompra: null,
      indiceEditandoCompra: null,
      seqAplicacaoComercialCompra: 0,
      margemInformadaManualCompra: false,
      isOrigemCompraCentralNfe: () => true,
      ORIGEM_BASE_COMERCIAL_COMPRA: { ITEM: 'item' },
      buscarUltimaCompraProduto: async () => null,
      resolverDadosComerciaisProdutoCompra: () => ({
        preco_unitario: 1.8,
        preco_venda_sugerido: 2.43,
        margem_lucro: 35,
        fallback: true,
        origem: 'padrao'
      }),
      obterModoPainelEmbalagemCompra: () => false,
      produtoUsaConversaoUnidadesCompra: () => false,
      normalizarPrecoVendaCentral: (valor) => valor == null ? null : Number(valor),
      calcularMargemBrutaCentralNfe: (custo, venda) =>
        venda > 0 ? ((venda - custo) / venda) * 100 : null,
      resolverCustoUnitarioCentralNfe: (item) => Number(item.preco_unitario || 0),
      resolverCustoMargemCentralNfe: (item) => Number(item.custo_unitario_final ?? item.custo_unitario ?? item.preco_unitario ?? 0),
      precoVendaCentralFoiAlterado: (original, atual) => original !== atual,
      formatNumberInput: (valor) => Number(valor).toFixed(2),
      atualizarIndicadorBaseComercialCompra: () => {},
      calcularValorVendaItem: () => {},
      obterProdutoSelecionadoCompra: () => ({ id: 1, preco_venda: 2.43 }),
      sincronizarDraftCompraDoFormulario: () => draft,
      $: (selector) => ({
        length: 1,
        val: (valor) => {
          if (valor !== undefined) campos[selector] = valor;
          return campos[selector];
        },
        text: (valor) => {
          if (valor !== undefined) campos[selector] = valor;
          return campos[selector];
        }
      })
    };
    vm.runInNewContext(
      `${normalizador[0]}\n${comparador[0]}\n${margem[0]}\n${atualizarExibicao[0]}\n${aplicarDados[0]}\n${marcarPreco[0]}`,
      contexto
    );

    await contexto.aplicarDadosComerciaisProdutoFormularioCompra(
      { id: 1, preco_venda: 2.43 },
      { recalcular: false }
    );
    assert.equal(campos['#preco_venda_item'], '2.43');
    assert.equal(campos['#margem_padrao_item'], '25.93%');
    assert.equal(Number(draft.margem_lucro.toFixed(2)), 25.93);

    campos['#preco_venda_item'] = '3.60';
    contexto.marcarPrecoVendaManualCompra();
    assert.equal(draft.precoVendaAtual, 3.6);
    assert.equal(draft.precoVendaAlteradoManualmente, true);
    assert.equal(campos['#margem_padrao_item'], '50.00%');
  });

  it('dados comerciais da Central ignoram margem cadastrada e não produzem venda sugerida', () => {
    const resolver = comprasJs.match(/function resolverDadosComerciaisProdutoCompra\([\s\S]*?\n\}/);
    assert.ok(resolver);
    const contexto = {
      isOrigemCompraCentralNfe: () => true,
      ORIGEM_BASE_COMERCIAL_COMPRA: { ULTIMA_COMPRA: 'ultima_compra' },
      extrairMargemCadastradaProduto: () => {
        throw new Error('margem cadastrada não deve ser consultada pela Central');
      }
    };
    vm.runInNewContext(`${resolver[0]}\nthis.resolver = resolverDadosComerciaisProdutoCompra;`, contexto);
    const dados = contexto.resolver({
      preco_compra: 1.8,
      preco_venda: 2.43,
      lucro_percentual: 35
    });
    assert.equal(dados.preco_unitario, 1.8);
    assert.equal(dados.preco_venda, 2.43);
    assert.equal(dados.margem_lucro, null);
    assert.equal(Object.hasOwn(dados, 'preco_venda_sugerido'), false);
    assert.equal(Object.hasOwn(dados, 'atualizar_preco_venda'), false);
  });

  it('Central detecta edição explícita do preço sem checkbox', () => {
    const matches = [
      comprasJs.match(/function alterarAtualizarPrecoItemCompra\([\s\S]*?\n\}/),
      comprasJs.match(/function alterarPrecoVendaItemCompra\([\s\S]*?\n\}/)
    ];
    assert.ok(matches.every(Boolean), 'handlers de preço e checkbox devem existir');
    const contexto = {
      isOrigemCompraCentralNfe: () => true,
      indiceEditandoCompra: null,
      itemDraftCompra: null,
      itensCompraAtual: [{
        preco_unitario: 10,
        precoVendaOriginal: 15,
        precoVendaAtual: 15,
        precoVendaAlteradoManualmente: false,
        margem_lucro: -50
      }],
      atualizarItemCompraImutavel: (index, atualizar) => {
        const draft = { ...contexto.itensCompraAtual[index] };
        atualizar(draft);
        contexto.itensCompraAtual[index] = draft;
      },
      calcularMargemBrutaCentralNfe: (custo, venda) => ((venda - custo) / venda) * 100,
      resolverCustoMargemCentralNfe: (item) => Number(item.custo_unitario_final ?? item.custo_unitario ?? item.preco_unitario ?? 0),
      normalizarPrecoVendaCentral: (valor) => {
        if (valor == null || String(valor).trim() === '') return null;
        const numero = Number(String(valor).replace(',', '.'));
        return Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 100) / 100 : null;
      },
      precoVendaCentralFoiAlterado: (original, atual) => atual != null && Math.round(Number(original) * 100) !== Math.round(Number(atual) * 100),
      document: { querySelector: () => contexto.margemEl },
      margemEl: { textContent: '' },
      formatNumberInput: (valor) => Number(valor).toFixed(2),
      renderItensCompraTabelaCore: () => { contexto.renderes = (contexto.renderes || 0) + 1; },
      focarCampoPrecoVendaItemCompra: () => {}
    };
    const normalizador = comprasJs.match(/function normalizarPrecoVendaCentral\([\s\S]*?\n\}/);
    const comparador = comprasJs.match(/function precoVendaCentralFoiAlterado\([\s\S]*?\n\}/);
    assert.ok(normalizador && comparador, 'normalização e comparação de preço devem existir');
    vm.runInNewContext(`${normalizador[0]}\n${comparador[0]}\n${matches[0][0]}\n${matches[1][0]}`, contexto);
    contexto.alterarPrecoVendaItemCompra(0, '18');
    assert.equal(contexto.itensCompraAtual[0].precoVendaAtual, 18);
    assert.equal(contexto.itensCompraAtual[0].precoVendaAlteradoManualmente, true);
    assert.equal(Number(contexto.itensCompraAtual[0].margem_lucro.toFixed(2)), 44.44);
    assert.equal(contexto.itensCompraAtual[0].atualizar_preco_venda, undefined);
    assert.equal(contexto.itensCompraAtual[0].atualizar_preco_venda_editado_manual, undefined);
    assert.equal(contexto.renderes || 0, 0, 'digitação não deve renderizar novamente a tabela');

    contexto.alterarPrecoVendaItemCompra(0, '15,00');
    assert.equal(contexto.itensCompraAtual[0].precoVendaAlteradoManualmente, false);
    assert.equal(contexto.itensCompraAtual[0].precoVendaAtual, 15);
    contexto.alterarAtualizarPrecoItemCompra(0, true);
    assert.equal(contexto.itensCompraAtual[0].atualizar_preco_venda, undefined);
    assert.equal(contexto.itensCompraAtual[0].atualizar_preco_venda_editado_manual, undefined);
  });

  it('detecta mudança por centavos e atualiza margem bruta em tempo real', () => {
    const normalizador = comprasJs.match(/function normalizarPrecoVendaCentral\([\s\S]*?\n\}/);
    const comparador = comprasJs.match(/function precoVendaCentralFoiAlterado\([\s\S]*?\n\}/);
    const margem = comprasJs.match(/function calcularMargemBrutaCentralNfe\([\s\S]*?\n\}/);
    const handler = comprasJs.match(/function alterarPrecoVendaItemCompra\([\s\S]*?\n\}/);
    assert.ok(normalizador && comparador && margem && handler);
    const contexto = {
      isOrigemCompraCentralNfe: () => true,
      indiceEditandoCompra: null,
      itemDraftCompra: null,
      itensCompraAtual: [{
        preco_unitario: 43.9,
        precoVendaOriginal: 4.85,
        precoVendaAtual: 4.85,
        precoVendaAlteradoManualmente: false
      }],
      atualizarItemCompraImutavel: (index, atualizar) => {
        const draft = { ...contexto.itensCompraAtual[index] };
        atualizar(draft);
        contexto.itensCompraAtual[index] = draft;
      },
      renderItensCompraTabelaCore: () => { throw new Error('não deve recarregar a tabela'); },
      focarCampoPrecoVendaItemCompra: () => {},
      formatNumberInput: (valor) => Number(valor).toFixed(2),
      margemEl: { textContent: '' },
      document: { querySelector: () => contexto.margemEl }
    };
    vm.runInNewContext(`${normalizador[0]}\n${comparador[0]}\n${margem[0]}\n${comprasJs.match(/function resolverCustoUnitarioCentralNfe\([\s\S]*?\n\}/)[0]}\n${handler[0]}`, contexto);

    assert.equal(contexto.precoVendaCentralFoiAlterado(4.85, 4.8500001), false);
    assert.equal(Number(contexto.calcularMargemBrutaCentralNfe(43.9, 4.85).toFixed(2)), -805.15);
    contexto.alterarPrecoVendaItemCompra(0, '55.00');
    assert.equal(contexto.itensCompraAtual[0].precoVendaAlteradoManualmente, true);
    assert.equal(Number(contexto.itensCompraAtual[0].margem_lucro.toFixed(2)), 20.18);
    assert.equal(contexto.margemEl.textContent, '20.18%');
    contexto.alterarPrecoVendaItemCompra(0, '60.00');
    assert.equal(Number(contexto.itensCompraAtual[0].margem_lucro.toFixed(2)), 26.83);
    contexto.alterarPrecoVendaItemCompra(0, '4.85');
    assert.equal(contexto.itensCompraAtual[0].precoVendaAlteradoManualmente, false);
  });

  it('somente o campo de identificação do produto fica somente leitura na Central', () => {
    assert.match(
      comprasJs,
      /id="codigo_barras_item"[^>]*\$\{isOrigemCompraCentralNfe\(\) \? 'readonly'/
    );
    assert.match(comprasJs, /<output class="form-control bg-light" id="margem_padrao_item"/);
    assert.match(comprasJs, /id="margem_padrao_item" value="" placeholder="cadastro \/ 35%"/);
    assert.match(comprasJs, /id="preco_venda_item" oninput="marcarPrecoVendaManualCompra\(\)"/);
    assert.match(comprasJs, /oninput="alterarPrecoVendaItemCompra\(\$\{index\}, this\.value\)"/);
    assert.doesNotMatch(comprasJs, /id="preco_venda_item"[^>]*readonly/);
  });

  it('margem bruta real e alertas de custo são informativos', () => {
    const margem = comprasJs.match(/function calcularMargemBrutaCentralNfe\([\s\S]*?\n\}/);
    assert.ok(margem, 'cálculo da margem bruta deve existir');
    const contextoMargem = {};
    vm.runInNewContext(`${margem[0]}\nthis.calcular = calcularMargemBrutaCentralNfe;`, contextoMargem);
    assert.equal(contextoMargem.calcular(2, 4), 50);
    assert.equal(Number(contextoMargem.calcular(1.78, 2.4).toFixed(2)), 25.83);
    assert.equal(Number(contextoMargem.calcular(1.75, 2.36).toFixed(2)), 25.85);
    assert.equal(Number(contextoMargem.calcular(1.78, 2.5).toFixed(2)), 28.8);
    assert.equal(Number(contextoMargem.calcular(1.78, 3).toFixed(2)), 40.67);
    assert.equal(Number(contextoMargem.calcular(1.5, 2.5).toFixed(2)), 40);
    assert.equal(Number(contextoMargem.calcular(1.78, 1.5).toFixed(2)), -18.67);
    assert.equal(Number(contextoMargem.calcular(43.9, 4.85).toFixed(2)), -805.15);
    assert.equal(Number(contextoMargem.calcular(43.9, 55).toFixed(2)), 20.18);
    assert.equal(Number(contextoMargem.calcular(43.9, 60).toFixed(2)), 26.83);
    assert.equal(contextoMargem.calcular(-1, 2.4), null);
    assert.equal(contextoMargem.calcular(1.5, 0), null);

    const margemAlteradaSemReload = [2.4, 2.5, 3, 2.4]
      .map((venda) => Number(contextoMargem.calcular(1.78, venda).toFixed(2)));
    assert.deepEqual(margemAlteradaSemReload, [25.83, 28.8, 40.67, 25.83]);

    const functions = comprasJs.match(
      /function resolverVariacaoCustoEntradaCentral\([\s\S]*?\n\}\n\nfunction renderAlertaVariacaoCustoEntradaCentral\([\s\S]*?\n\}/
    );
    assert.ok(functions, 'helpers do alerta de custo devem existir');
    const contexto = {
      isOrigemCompraCentralNfe: () => true,
      resolverCustoUnitarioCentralNfe: (item) => Number(item.custo_unitario_final ?? item.custo_unitario ?? item.preco_unitario ?? 0),
      formatCurrency: (valor) => Number(valor).toFixed(2)
    };
    vm.runInNewContext(`${functions[0]}\nthis.renderAlerta = renderAlertaVariacaoCustoEntradaCentral;`, contexto);

    assert.match(contexto.renderAlerta({ custo_anterior_produto: 1.5, preco_unitario: 1.85 }), /custo de compra deste produto aumentou/i);
    assert.match(contexto.renderAlerta({ custo_anterior_produto: 1.85, preco_unitario: 1.5 }), /custo de compra deste produto diminuiu/i);
    assert.equal(contexto.renderAlerta({ custo_anterior_produto: 1.85, preco_unitario: 1.85 }), '');
    assert.match(contexto.renderAlerta({ custo_anterior_produto: 1.5, preco_unitario: 1.85 }), /preço de venda não foi alterado/i);
  });

  it('mantém markup da compra manual isolado do cálculo de margem da Central NF-e', () => {
    const recalcular = comprasJs.match(/function recalcularFormacaoPrecoDraftCompra\([\s\S]*?\n\}/);
    assert.ok(recalcular, 'recalculo existente da compra manual deve continuar presente');
    assert.doesNotMatch(comprasJs, /function calcularMargemBrutaCompra\(/);
    const contexto = {
      itemDraftCompra: {
        preco_unitario: 2,
        margem_lucro: 100,
        preco_venda_sugerido: 0,
        quantidade_por_embalagem: 0
      },
      isOrigemCompraCentralNfe: () => false
    };
    vm.runInNewContext(`${recalcular[0]}\nthis.recalcular = recalcularFormacaoPrecoDraftCompra;`, contexto);
    contexto.recalcular('margem');
    assert.equal(contexto.itemDraftCompra.preco_venda_sugerido, 4);
    assert.equal(contexto.itemDraftCompra.margem_lucro, 100);
  });

  it('TESTE A — produto 37% prevalece sobre 30 do XML', () => {
    const item = { produto_id: 1, margem_lucro: 30 };
    const produto = { id: 1, lucro_percentual: 37 };
    const r = resolverMargemItem(item, produto, true);
    assert.equal(r.margem, 37);
    assert.equal(r.fallback, false);
  });

  it('TESTE B — produto 42%', () => {
    const item = { produto_id: 2, margem_lucro: 30 };
    const produto = { id: 2, lucro_percentual: 42 };
    assert.equal(resolverMargemItem(item, produto, true).margem, 42);
  });

  it('TESTE C — produto sem percentual → fallback 35', () => {
    const item = { produto_id: 3, margem_lucro: 30 };
    const produto = { id: 3, nome: 'Sem %' };
    const r = resolverMargemItem(item, produto, true);
    assert.equal(r.margem, 35);
    assert.equal(r.fallback, true);
  });

  it('TESTE D — XML 30 + produto 37 → 37', () => {
    const item = { produto_id: 10, margem_lucro: 30, margem_origem: 'xml_default' };
    const produto = { lucro_percentual: 37 };
    assert.equal(resolverMargemItem(item, produto, true).margem, 37);
  });

  it('TESTE E — MIIP automático (produto_id + cadastro 42)', () => {
    assert.match(comprasJs, /associadoAutomaticamente[\s\S]*?aplicarMargemDoProdutoNoItemCompra/);
    const item = { produto_id: 5 };
    const produto = { lucro_percentual: 42 };
    assert.equal(resolverMargemItem(item, produto, true).margem, 42);
  });

  it('TESTE F — associação manual 27%', () => {
    assert.match(comprasJs, /alterarProdutoItemCompra|extrairMargemCadastradaProduto\(produto\)/);
    const item = { produto_id: 7, margem_lucro: 30 };
    assert.equal(resolverMargemItem(item, { lucro_percentual: 27 }, true).margem, 27);
  });

  it('TESTE G — precisão 33.33', () => {
    const r = extrairMargemCadastradaProduto({ lucro_percentual: 33.33 });
    assert.equal(r.margem, 33.33);
  });

  it('TESTE H — edição manual 40% não é sobrescrita', () => {
    const item = {
      produto_id: 1,
      margem_lucro: 40,
      margem_editada_manual: 1,
      margem_origem: 'manual'
    };
    const produto = { lucro_percentual: 37 };
    const r = resolverMargemItem(item, produto, true);
    assert.equal(r.margem, 40);
  });

  it('TESTE I — preço de venda editado manualmente não é sobrescrito pelo % do cadastro', () => {
    assert.match(comprasJs, /function marcarPrecoVendaManualCompra/);
    assert.match(comprasJs, /oninput="marcarPrecoVendaManualCompra\(\)"/);
    assert.match(comprasJs, /margemManualCommit/);

    const item = {
      produto_id: 1,
      preco_unitario: 10,
      margem_lucro: 50,
      preco_venda_sugerido: 15,
      margem_editada_manual: 1,
      margem_origem: 'manual',
      atualizar_preco_venda: 1
    };
    const produto = { lucro_percentual: 35 };
    assert.equal(deveReaplicarMargemCadastroItemCompra(item, true), false);
    assert.equal(resolverMargemItem(item, produto, true).margem, 50);

    // Simula sincronizarPrecosCadastroItemCompra com venda manual
    const vendaManual = Number(item.margem_editada_manual) === 1 || item.margem_origem === 'manual';
    let precoVenda = Number(item.preco_venda_sugerido);
    if (vendaManual && precoVenda > 0) {
      precoVenda = Number(precoVenda.toFixed(2));
    } else {
      precoVenda = Number((item.preco_unitario * (1 + 35 / 100)).toFixed(2));
    }
    assert.equal(precoVenda, 15);
  });

  it('produto 25%', () => {
    assert.equal(
      resolverMargemItem({ produto_id: 1, margem_lucro: 30 }, { lucro_percentual: 25 }, true).margem,
      25
    );
  });

  it('escala 30 = 30% (não 0.30)', () => {
    const r = extrairMargemCadastradaProduto({ lucro_percentual: 30 });
    assert.equal(r.margem, 30);
    assert.notEqual(r.margem, 0.3);
  });
});

describe('CORREÇÃO-NF-MARGEM-01 — helpers no frontend', () => {
  it('expose helpers de reaplicação', () => {
    assert.match(comprasJs, /function deveReaplicarMargemCadastroItemCompra/);
    assert.match(comprasJs, /function aplicarMargemDoProdutoNoItemCompra/);
    assert.match(comprasJs, /MARGEM_PADRAO_FALLBACK_COMPRA = 35/);
  });

  it('marcarMargemManual marca origem manual', () => {
    assert.match(comprasJs, /margem_editada_manual\s*=\s*1/);
    assert.match(comprasJs, /margem_origem\s*=\s*'manual'/);
  });
});
