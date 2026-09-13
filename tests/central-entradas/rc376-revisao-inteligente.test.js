/**
 * RC3.7.6 — Central de Revisão Inteligente (READ-ONLY)
 * Executar: node tests/central-entradas/rc376-revisao-inteligente.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const Intel = require(path.join(
  __dirname,
  '../../frontend/erp/js/miip-central-revisao-inteligente.js'
));

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      ok += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhas += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${err.message}`);
    });
}

async function main() {
  console.log('\n=== RC3.7.6 / 6.1–6.5 — Revisão Inteligente ===\n');

  await test('Comparador: custo aumentou / reduziu / sem alteração', async () => {
    const snap = Intel.montarSnapshot({
      itens: [
        { produto_nome: 'Cabo 2,5', preco_unitario: 84, produto_id: 1, margem_lucro: 30 },
        { produto_nome: 'Joelho 100mm', preco_unitario: 5.8, produto_id: 2, margem_lucro: 30 },
        { produto_nome: 'Igual', preco_unitario: 10, produto_id: 3, margem_lucro: 30 }
      ],
      resultadosMiip: [],
      produtos: [
        { id: 1, nome: 'Cabo', preco_compra: 80, preco_venda: 104, lucro_percentual: 30 },
        { id: 2, nome: 'Joelho', preco_compra: 6, preco_venda: 7.8, lucro_percentual: 30 },
        { id: 3, nome: 'Igual', preco_compra: 10, preco_venda: 13, lucro_percentual: 30 }
      ]
    });

    assert.strictEqual(snap.linhas[0].situacao, 'aumentou');
    assert.strictEqual(snap.linhas[0].diferencaPct, 5);
    assert.strictEqual(snap.linhas[1].situacao, 'reduziu');
    assert.ok(snap.linhas[1].diferencaPct < 0);
    assert.strictEqual(snap.linhas[2].situacao, 'sem_alteracao');
    assert.strictEqual(snap.indicadores.custoAumentou, 1);
    assert.strictEqual(snap.indicadores.custoReduziu, 1);
    assert.strictEqual(snap.indicadores.semAlteracao, 1);
  });

  await test('Sem cadastro e produto descontinuado', async () => {
    const snap = Intel.montarSnapshot({
      itens: [
        { produto_nome: 'Novo', preco_unitario: 12 },
        { produto_nome: 'Velho', preco_unitario: 20, produto_id: 9 }
      ],
      resultadosMiip: [
        { indice: 0, precisaCadastro: true, produtoEncontrado: null },
        { indice: 1, precisaConfirmacao: true, produtoEncontrado: { id: 9, nome: 'Velho' } }
      ],
      produtos: [
        { id: 9, nome: 'Velho', preco_compra: 18, preco_venda: 25, ativo: 0 }
      ]
    });
    assert.strictEqual(snap.linhas[0].situacao, 'sem_cadastro');
    assert.strictEqual(snap.linhas[1].situacao, 'descontinuado');
    assert.ok(snap.indicadores.semCadastro >= 1);
  });

  await test('Sugestão de preço usa margem cadastrada e não muta produto', async () => {
    const produto = { id: 1, preco_compra: 100, preco_venda: 130, lucro_percentual: 25 };
    const clone = JSON.parse(JSON.stringify(produto));
    const sugerido = Intel.precoSugerido(110, 25);
    assert.strictEqual(sugerido, 137.5);
    assert.deepStrictEqual(produto, clone);
    assert.strictEqual(Intel.montarSnapshot({
      itens: [{ preco_unitario: 110, produto_id: 1 }],
      produtos: [produto]
    }).linhas[0].precoSugerido, 137.5);
  });

  await test('Filtros visuais', async () => {
    const snap = Intel.montarSnapshot({
      itens: [
        { produto_nome: 'A', preco_unitario: 84, produto_id: 1 },
        { produto_nome: 'B', preco_unitario: 5.8, produto_id: 2 },
        { produto_nome: 'C', preco_unitario: 10 }
      ],
      resultadosMiip: [
        { indice: 2, precisaCadastro: true, produtoEncontrado: null }
      ],
      produtos: [
        { id: 1, preco_compra: 80, lucro_percentual: 30 },
        { id: 2, preco_compra: 6, lucro_percentual: 30 }
      ]
    });
    assert.strictEqual(Intel.filtrarLinhas(snap, 'todos').length, 3);
    assert.strictEqual(Intel.filtrarLinhas(snap, 'alterados').length, 2);
    assert.strictEqual(Intel.filtrarLinhas(snap, 'sem_cadastro').length, 1);
    assert.ok(Intel.filtrarLinhas(snap, 'divergentes').length >= 3);
  });

  await test('Snapshot é imutável quanto a produtos/itens de entrada', async () => {
    const itens = [{ produto_nome: 'X', preco_unitario: 50, produto_id: 1 }];
    const produtos = [{ id: 1, preco_compra: 40, preco_venda: 52, lucro_percentual: 30 }];
    const itensJson = JSON.stringify(itens);
    const prodJson = JSON.stringify(produtos);
    Intel.montarSnapshot({ itens, produtos, resultadosMiip: [] });
    assert.strictEqual(JSON.stringify(itens), itensJson);
    assert.strictEqual(JSON.stringify(produtos), prodJson);
  });

  await test('Mensagem de resumo padrão', async () => {
    const snap = Intel.montarSnapshot({ itens: [], produtos: [] });
    assert.strictEqual(snap.mensagemResumo, 'Nenhum preço será alterado automaticamente.');
  });

  await test('Meta de alertas (cores)', async () => {
    assert.strictEqual(Intel.metaSituacao('sem_alteracao').cor, 'verde');
    assert.strictEqual(Intel.metaSituacao('aumentou').cor, 'amarelo');
    assert.strictEqual(Intel.metaSituacao('sem_cadastro').cor, 'vermelho');
    assert.strictEqual(Intel.metaSituacao('descontinuado').cor, 'azul');
  });

  // —— RC3.7.6.1 Histórico Comercial ——
  await test('RC3.7.6.1 Histórico: produto existente com comparação', async () => {
    const hist = Intel.montarHistoricoComercial({
      produtoId: 1,
      produtos: [
        { id: 1, preco_compra: 84.5, preco_venda: 119.9, lucro_percentual: 29 }
      ],
      custoNfe: 89.2
    });
    assert.strictEqual(hist.disponivel, true);
    assert.strictEqual(hist.ultimoCusto, 84.5);
    assert.strictEqual(hist.custoNfe, 89.2);
    assert.strictEqual(hist.precoVendaAtual, 119.9);
    assert.strictEqual(hist.margemAtual, 29);
    assert.ok(Math.abs(hist.diferencaPct - 5.56) < 0.02);
    assert.strictEqual(hist.faixa.classe, 'amarelo');
    assert.ok(hist.tooltip.includes('Último custo cadastrado'));
    assert.ok(hist.tooltip.includes('Novo custo da NF-e'));
  });

  await test('RC3.7.6.1 Histórico: produto novo sem erro', async () => {
    const hist = Intel.montarHistoricoComercial({
      produtoId: null,
      produtos: [{ id: 1, preco_compra: 10 }],
      custoNfe: 12
    });
    assert.strictEqual(hist.disponivel, false);
    assert.strictEqual(hist.produtoNovo, true);
    assert.ok(String(hist.mensagem).includes('Produto Novo'));
    assert.ok(String(hist.mensagem).includes('indisponível'));
  });

  await test('RC3.7.6.1 Faixas de cor da diferença', async () => {
    assert.strictEqual(Intel.corFaixaDiferencaCusto(1).classe, 'cinza');
    assert.strictEqual(Intel.corFaixaDiferencaCusto(5.56).classe, 'amarelo');
    assert.strictEqual(Intel.corFaixaDiferencaCusto(15).classe, 'laranja');
    assert.strictEqual(Intel.corFaixaDiferencaCusto(25).classe, 'vermelho');
    assert.strictEqual(Intel.corFaixaDiferencaCusto(-12).classe, 'laranja');
  });

  await test('RC3.7.6.1 JOIN em memória por id (sem mutar produtos)', async () => {
    const produtos = [{ id: 7, preco_compra: 50, preco_venda: 70, lucro_percentual: 40 }];
    const before = JSON.stringify(produtos);
    const hist = Intel.montarHistoricoComercial({
      produtoId: 7,
      produtos,
      custoNfe: 50
    });
    assert.strictEqual(hist.disponivel, true);
    assert.strictEqual(hist.faixa.classe, 'cinza');
    assert.strictEqual(JSON.stringify(produtos), before);
  });

  // —— RC3.7.6.2 Ordenação ——
  await test('RC3.7.6.2 Ordem NF-e preservada e sem mutar original', async () => {
    const entradas = [
      { listaIdx: 0, linha: { indice: 0, nome: 'C', diferencaPct: 1, valorTotal: 10 } },
      { listaIdx: 1, linha: { indice: 1, nome: 'A', diferencaPct: 30, valorTotal: 5 } },
      { listaIdx: 2, linha: { indice: 2, nome: 'B', diferencaPct: -8, valorTotal: 20 } }
    ];
    const before = JSON.stringify(entradas);
    const ord = Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.NFE, false);
    assert.deepStrictEqual(ord.map((e) => e.listaIdx), [0, 1, 2]);
    assert.strictEqual(JSON.stringify(entradas), before);
  });

  await test('RC3.7.6.2 Ordenação por aumento / redução / valor / nome', async () => {
    const entradas = [
      { listaIdx: 0, linha: { indice: 0, nome: 'Cabo', diferencaPct: 5, valorTotal: 100, situacao: 'aumentou' } },
      { listaIdx: 1, linha: { indice: 1, nome: 'Joelho', diferencaPct: 25, valorTotal: 50, situacao: 'aumentou' } },
      { listaIdx: 2, linha: { indice: 2, nome: 'Abraçadeira', diferencaPct: -12, valorTotal: 200, situacao: 'reduziu' } }
    ];
    assert.deepStrictEqual(
      Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.AUMENTO, false).map((e) => e.listaIdx),
      [1, 0, 2]
    );
    assert.deepStrictEqual(
      Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.REDUCAO, false).map((e) => e.listaIdx),
      [2, 0, 1]
    );
    assert.deepStrictEqual(
      Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.VALOR, false).map((e) => e.listaIdx),
      [2, 0, 1]
    );
    assert.deepStrictEqual(
      Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.NOME, false).map((e) => e.listaIdx),
      [2, 0, 1]
    );
  });

  await test('RC3.7.6.2 Produtos novos e sem cadastro no topo', async () => {
    const entradas = [
      { listaIdx: 0, linha: { indice: 0, nome: 'X', diferencaPct: 0, situacao: 'sem_alteracao' } },
      { listaIdx: 1, linha: { indice: 1, nome: 'Novo', produtoNovo: true, situacao: 'sem_cadastro', semCadastro: true } },
      { listaIdx: 2, linha: { indice: 2, nome: 'Sem', situacao: 'sem_cadastro', semCadastro: true } }
    ];
    assert.strictEqual(
      Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.NOVOS, false)[0].listaIdx,
      1
    );
    assert.ok(
      Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.SEM_CADASTRO, false)
        .slice(0, 2)
        .every((e) => e.listaIdx === 1 || e.listaIdx === 2)
    );
  });

  await test('RC3.7.6.2 Prioridades e fixar prioritários', async () => {
    assert.strictEqual(Intel.classificarPrioridade({ produtoNovo: true }).nivel, 'alta');
    assert.strictEqual(Intel.classificarPrioridade({ diferencaPct: 25 }).nivel, 'alta');
    assert.strictEqual(Intel.classificarPrioridade({ diferencaPct: 10 }).nivel, 'media');
    assert.strictEqual(Intel.classificarPrioridade({ diferencaPct: 2 }).nivel, 'baixa');

    const entradas = [
      { listaIdx: 0, linha: { indice: 0, nome: 'Baixo', diferencaPct: 1 } },
      { listaIdx: 1, linha: { indice: 1, nome: 'Alto', diferencaPct: 30 } },
      { listaIdx: 2, linha: { indice: 2, nome: 'Medio', diferencaPct: 8 } }
    ];
    const ord = Intel.ordenarEntradasVisuais(entradas, Intel.ORDENS.NFE, true);
    assert.deepStrictEqual(ord.map((e) => e.listaIdx), [1, 2, 0]);

    const cont = Intel.contarPrioridades(entradas.map((e) => e.linha));
    assert.strictEqual(cont.alta, 1);
    assert.strictEqual(cont.media, 1);
    assert.strictEqual(cont.baixa, 1);
  });

  await test('RC3.7.6.2 localStorage prefs (mock)', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    assert.strictEqual(Intel.salvarPrefsLocal({
      ordenacao: Intel.ORDENS.AUMENTO,
      filtro: 'alterados',
      fixarPrioritarios: true
    }), true);
    const lido = Intel.lerPrefsLocal();
    assert.strictEqual(lido.ordenacao, 'aumento');
    assert.strictEqual(lido.filtro, 'alterados');
    assert.strictEqual(lido.fixarPrioritarios, true);
    delete global.localStorage;
  });

  // —— RC3.7.6.3 Dashboard impacto ——
  await test('RC3.7.6.3 Impacto: somas, saldo e maiores', async () => {
    const snap = Intel.montarSnapshot({
      itens: [
        { produto_nome: 'Cimento CP2', preco_unitario: 30, quantidade: 100, produto_id: 1 }, // +5*100=+500
        { produto_nome: 'Tinta Coral', preco_unitario: 40, quantidade: 10, produto_id: 2 },   // -5*10=-50
        { produto_nome: 'Igual', preco_unitario: 10, quantidade: 2, produto_id: 3 }
      ],
      produtos: [
        { id: 1, preco_compra: 25, preco_venda: 40, lucro_percentual: 30 },
        { id: 2, preco_compra: 45, preco_venda: 60, lucro_percentual: 30 },
        { id: 3, preco_compra: 10, preco_venda: 13, lucro_percentual: 30 }
      ]
    });
    const d = snap.impacto;
    assert.strictEqual(d.disponivel, true);
    assert.strictEqual(d.aumentoTotal, 500);
    assert.strictEqual(d.reducaoTotal, 50);
    assert.strictEqual(d.saldo, 450);
    assert.strictEqual(d.produtosAlterados, 2);
    assert.strictEqual(d.maiorAumento.nome, 'Cimento CP2');
    assert.strictEqual(d.maiorAumento.impactoAbsoluto, 500);
    assert.strictEqual(d.maiorReducao.nome, 'Tinta Coral');
    assert.strictEqual(d.maiorReducao.impactoAbsoluto, -50);
    assert.ok(d.maiorAumento.tooltip.includes('Último custo'));
    assert.ok(d.maiorAumento.tooltip.includes('Impacto financeiro'));
  });

  await test('RC3.7.6.3 Produtos novos: histórico insuficiente', async () => {
    const snap = Intel.montarSnapshot({
      itens: [
        { produto_nome: 'Novo A', preco_unitario: 12, quantidade: 1 },
        { produto_nome: 'Novo B', preco_unitario: 8, quantidade: 2 }
      ],
      resultadosMiip: [
        { indice: 0, precisaCadastro: true, produtoEncontrado: null },
        { indice: 1, precisaCadastro: true, produtoEncontrado: null }
      ],
      produtos: []
    });
    assert.strictEqual(snap.impacto.disponivel, false);
    assert.ok(String(snap.impacto.mensagem).includes('Histórico insuficiente'));
  });

  await test('RC3.7.6.3 Dashboard não muta linhas de entrada', async () => {
    const linhas = [
      { nome: 'A', impactoAbsoluto: 10, situacao: 'aumentou', custoAtual: 1, custoNfe: 2, quantidade: 10 }
    ];
    const before = JSON.stringify(linhas);
    Intel.montarDashboardImpacto(linhas);
    assert.strictEqual(JSON.stringify(linhas), before);
  });

  // —— RC3.7.6.4 Últimas compras ——
  await test('RC3.7.6.4 Ordenação recente→antiga e limite 5', async () => {
    const rows = [
      { data: '2024-01-01', fornecedor: 'A', custo: 10, quantidade: 1, nfe: '1', compra_id: 1 },
      { data: '2024-06-01', fornecedor: 'B', custo: 12, quantidade: 2, nfe: '2', compra_id: 2 },
      { data: '2025-01-15', fornecedor: 'C', custo: 8, quantidade: 3, nfe: '3', compra_id: 3 },
      { data: '2023-12-01', fornecedor: 'D', custo: 20, quantidade: 1, nfe: '4', compra_id: 4 },
      { data: '2024-03-01', fornecedor: 'E', custo: 15, quantidade: 1, nfe: '5', compra_id: 5 },
      { data: '2022-01-01', fornecedor: 'F', custo: 9, quantidade: 1, nfe: '6', compra_id: 6 }
    ];
    const before = JSON.stringify(rows);
    const view = Intel.montarUltimasCompras(rows, 5);
    assert.strictEqual(JSON.stringify(rows), before);
    assert.strictEqual(view.disponivel, true);
    assert.strictEqual(view.registros.length, 5);
    assert.strictEqual(view.registros[0].fornecedor, 'C');
    assert.strictEqual(view.registros[0].ehUltimaCompra, true);
    assert.ok(!view.registros.some((r) => r.fornecedor === 'F'));
  });

  await test('RC3.7.6.4 Destaques menor/maior/último + resumo', async () => {
    const view = Intel.montarUltimasCompras([
      { data: '2025-03-01', fornecedor: 'Ult', custo_unitario_final: 11, quantidade: 2, numero_nf: '100' },
      { data: '2025-02-01', fornecedor: 'Barato', preco_unitario: 7, quantidade: 1, numero_nf: '90' },
      { data: '2025-01-01', fornecedor: 'Caro', custo: 30, quantidade: 5, nfe: '80' }
    ], 5);
    assert.strictEqual(view.resumo.quantidadeAnalisadas, 3);
    assert.strictEqual(view.resumo.ultimoCusto, 11);
    assert.strictEqual(view.resumo.menorCusto, 7);
    assert.strictEqual(view.resumo.maiorCusto, 30);
    assert.strictEqual(view.registros[0].ehUltimaCompra, true);
    assert.strictEqual(view.registros.find((r) => r.fornecedor === 'Barato').ehMenorCusto, true);
    assert.strictEqual(view.registros.find((r) => r.fornecedor === 'Caro').ehMaiorCusto, true);
  });

  await test('RC3.7.6.4 Sem histórico sem erro', async () => {
    const view = Intel.montarUltimasCompras([], 5);
    assert.strictEqual(view.disponivel, false);
    assert.strictEqual(view.mensagem, Intel.MSG_SEM_COMPRAS);
    assert.strictEqual(view.resumo.quantidadeAnalisadas, 0);
  });

  await test('RC3.7.6.4 Cache em memória por produto', async () => {
    const cache = {};
    assert.strictEqual(Intel.lerCacheUltimasCompras(cache, 10), null);
    assert.strictEqual(Intel.precisaBuscarUltimasCompras(cache, 10), true);
    const payload = { status: 'ok', view: Intel.montarUltimasCompras([{ data: '2025-01-01', custo: 5, quantidade: 1 }]) };
    assert.strictEqual(Intel.gravarCacheUltimasCompras(cache, 10, payload), true);
    assert.strictEqual(Intel.lerCacheUltimasCompras(cache, 10), payload);
    assert.strictEqual(Intel.precisaBuscarUltimasCompras(cache, 10), false);
    assert.strictEqual(Intel.lerCacheUltimasCompras(cache, 11), null);
    assert.strictEqual(Intel.precisaBuscarUltimasCompras(cache, 11), true);
    // segunda seleção do mesmo produto — não “precisa buscar”
    Intel.gravarCacheUltimasCompras(cache, 10, payload);
    assert.strictEqual(Object.keys(cache).length, 1);
    assert.strictEqual(Intel.precisaBuscarUltimasCompras(cache, 10), false);
  });

  await test('RC3.7.6.4 Liberar cache ao fechar revisão', async () => {
    const cache = {
      10: { status: 'ok', view: {} },
      20: { status: 'loading' }
    };
    Intel.liberarCacheUltimasCompras(cache);
    assert.deepStrictEqual(cache, {});
    assert.strictEqual(Intel.precisaBuscarUltimasCompras(cache, 10), true);
  });

  await test('RC3.7.6.4 Prefs expandido no localStorage', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    Intel.salvarPrefsLocal({
      ordenacao: 'nfe',
      filtro: 'todos',
      fixarPrioritarios: false,
      ultimasComprasExpandido: false
    });
    const lido = Intel.lerPrefsLocal();
    assert.strictEqual(lido.ultimasComprasExpandido, false);
    assert.strictEqual(lido.paineis.ultimasCompras, false);
    Intel.salvarPrefsLocal({
      ordenacao: 'nfe',
      filtro: 'todos',
      fixarPrioritarios: false,
      ultimasComprasExpandido: true
    });
    assert.strictEqual(Intel.lerPrefsLocal().ultimasComprasExpandido, true);
    delete global.localStorage;
  });

  // —— RC3.7.6.5 Layout / modo foco ——
  await test('RC3.7.6.5 Alternar painéis sem perder demais', async () => {
    const base = Intel.normalizarPaineis({});
    assert.strictEqual(base.dashboardComercial, true);
    assert.strictEqual(base.historicoComercial, true);
    assert.strictEqual(base.ultimasCompras, true);
    const a = Intel.alternarPainel(base, Intel.PAINEIS.DASHBOARD);
    assert.strictEqual(a.dashboardComercial, false);
    assert.strictEqual(a.historicoComercial, true);
    assert.strictEqual(Intel.painelExpandido(a, 'dashboardComercial'), false);
    assert.strictEqual(Intel.painelExpandido(a, 'historicoComercial'), true);
  });

  await test('RC3.7.6.5 Modo foco restaura estado anterior', async () => {
    const inicio = {
      modoFoco: false,
      paineis: {
        dashboardComercial: false,
        historicoComercial: true,
        ultimasCompras: false
      },
      _focoSnapshot: null
    };
    const foco = Intel.aplicarModoFocoLayout(inicio, true);
    assert.strictEqual(foco.modoFoco, true);
    assert.deepStrictEqual(foco.paineis, inicio.paineis);
    assert.ok(foco._focoSnapshot);
    // simula alteração durante o foco
    foco.paineis = Intel.normalizarPaineis({
      dashboardComercial: true,
      historicoComercial: false,
      ultimasCompras: true
    });
    const volta = Intel.aplicarModoFocoLayout(foco, false);
    assert.strictEqual(volta.modoFoco, false);
    assert.strictEqual(volta._focoSnapshot, null);
    assert.deepStrictEqual(volta.paineis, inicio.paineis);
  });

  await test('RC3.7.6.5 Prefs painéis + modoFoco no localStorage', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    assert.strictEqual(Intel.salvarPrefsLocal({
      ordenacao: 'valor',
      filtro: 'novos',
      fixarPrioritarios: true,
      paineis: {
        dashboardComercial: false,
        historicoComercial: true,
        ultimasCompras: false
      },
      modoFoco: true
    }), true);
    const lido = Intel.lerPrefsLocal();
    assert.strictEqual(lido.ordenacao, 'valor');
    assert.strictEqual(lido.modoFoco, true);
    assert.strictEqual(lido.paineis.dashboardComercial, false);
    assert.strictEqual(lido.paineis.historicoComercial, true);
    assert.strictEqual(lido.paineis.ultimasCompras, false);
    delete global.localStorage;
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falhas\n`);
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
