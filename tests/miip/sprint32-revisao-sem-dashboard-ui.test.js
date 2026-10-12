'use strict';

/**
 * Sprint 3.2 — "Conferir produtos da nota" sem o Dashboard Comercial.
 *
 * Abre a revisão real (miip-central-revisao-inteligente.js + miip-central-revisao.js) por
 * MiipCentralRevisao.iniciar, com jQuery mínimo que grava o HTML de cada alvo e API simulada.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const ler = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const JS_INTELIGENTE = ler('frontend/erp/js/miip-central-revisao-inteligente.js');
const JS_REVISAO = ler('frontend/erp/js/miip-central-revisao.js');

const TEXTOS_DASHBOARD = [
  'Dashboard Comercial',
  'Impacto Financeiro',
  'Resumo Comercial',
  'Produtos Novos',
  'Custo Aumentou',
  'Custo Reduziu',
  'Sem Alteração',
  'Sem Cadastro',
  'Precisão desta importação',
  'Tempo de processamento',
  'Comparador de custos',
  'Sugestão de preço',
  'Preço Sugerido',
  'data-miip-filtro',
  'miipCentralResumoFinal'
];

function criarJquery(registro) {
  function no(chave) {
    const alvo = {
      length: 1,
      html(v) {
        if (v === undefined) return registro[chave] || '';
        registro[chave] = String(v);
        return proxy;
      },
      text(v) {
        if (v === undefined) return registro[`${chave}:text`] || '';
        registro[`${chave}:text`] = String(v);
        return proxy;
      },
      append(v) {
        registro[chave] = (registro[chave] || '') + String(v);
        return proxy;
      },
      is() { return false; },
      hasClass() { return false; },
      data() { return undefined; },
      val() { return ''; }
    };
    const proxy = new Proxy(alvo, {
      get(t, k) {
        if (typeof k === 'symbol' || k === 'then') return undefined;
        return k in t ? t[k] : () => proxy;
      }
    });
    return proxy;
  }
  const $ = (sel) => no(typeof sel === 'string' ? sel : '[objeto]');
  $.ajax = () => Promise.resolve({ sucesso: true });
  return $;
}

/** Preferências salvas antes da sprint: filtro comercial "Alterados" e dashboard aberto. */
const PREFS_ANTIGAS = JSON.stringify({
  filtro: 'alterados',
  ordenacao: 'nfe',
  paineis: { dashboardComercial: true, historicoComercial: true, ultimasCompras: true }
});

function criarTela({ conversoes = [] } = {}) {
  const registro = {};
  const chamadas = [];
  const notificacoes = [];
  const elementos = { miipCentralConversoes: { innerHTML: '' } };

  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    setImmediate,
    structuredClone,
    localStorage: {
      getItem: (k) => (k === 'token' ? null : PREFS_ANTIGAS),
      setItem() {},
      removeItem() {}
    },
    showNotification: (msg, tipo) => notificacoes.push({ msg, tipo }),
    bootstrap: {
      Modal: class {
        show() {}
        hide() {}
        static getOrCreateInstance() { return new this(); }
        static getInstance() { return null; }
      }
    },
    fetch: async (url, init = {}) => {
      chamadas.push({ url, metodo: init.method || 'GET', corpo: init.body ? JSON.parse(init.body) : null });
      let corpo = {};
      if (/\/revisar\/conversoes$/.test(url)) {
        corpo = { linhas: conversoes, bloqueia_efetivacao: conversoes.some((l) => l.requer_confirmacao) };
      } else if (/ultimas-compras/.test(url)) {
        corpo = { compras: [] };
      }
      return { ok: true, status: 200, json: async () => corpo };
    }
  };
  context.document = {
    getElementById: (id) => elementos[id] || null,
    querySelector: () => null,
    addEventListener() {}
  };
  context.window = context;
  context.$ = criarJquery(registro);
  context.jQuery = context.$;
  vm.createContext(context);
  vm.runInContext(JS_INTELIGENTE, context, { filename: 'miip-central-revisao-inteligente.js' });
  vm.runInContext(JS_REVISAO, context, { filename: 'miip-central-revisao.js' });
  return { context, registro, chamadas, notificacoes, elementos };
}

function dadosNota() {
  const itens = [
    { produto_nome: 'POLPA MARACUJA 400G', unidade: 'UN', quantidade: 10, preco_unitario: 5, codigo_fornecedor: '1', ncm: '20089900', codigo_barras: 'SEM GTIN' },
    { produto_nome: 'REFRIGERANTE COLA 2L', unidade: 'UN', quantidade: 6, preco_unitario: 7, codigo_fornecedor: '55', codigo_barras: '7890000000017' },
    { produto_nome: 'AGUA MINERAL 500ML', unidade: 'UN', quantidade: 12, preco_unitario: 1.5, codigo_fornecedor: '77', produto_id: 902 },
    { produto_nome: 'POLPA GOIABA 400G', unidade: 'CX', quantidade: 2, preco_unitario: 30, codigo_fornecedor: '2', ncm: '20089900' }
  ];
  const refri = { id: 901, nome: 'Refrigerante Cola 2L', unidade: 'UN', codigo_barras: '7890000000017', preco_custo: 6.5, preco_venda: 9.99, ativo: 1 };
  const agua = { id: 902, nome: 'Agua Mineral 500ml', unidade: 'UN', preco_custo: 1.5, preco_venda: 2.5, ativo: 1 };
  const goiaba = { id: 904, nome: 'Polpa de Goiaba 400g', unidade: 'UN', ncm: '20089900', preco_custo: 2.4, preco_venda: 4.5, ativo: 1 };
  return {
    produtos: [refri, agua, goiaba],
    dadosImportacao: {
      fornecedor: 'Fornecedor de polpas e bebidas (teste)',
      fornecedor_cnpj: '00000000000191',
      itens,
      miip_importacao: {
        usarMiipImportacaoXML: true,
        resumo: { totalItens: 4, identificadosAutomaticamente: 1, precisamConfirmacao: 2, precisamCadastro: 1 },
        resultados: [
          { indice: 0, precisaCadastro: true, precisaConfirmacao: false, produtoEncontrado: null, score: 0, produtoXML: itens[0], candidatos: [], acao: 'criar_novo' },
          { indice: 1, precisaConfirmacao: true, produtoEncontrado: refri, score: 90, produtoXML: itens[1], candidatos: [{ produtoId: 901, score: 90, produto: refri }], acao: 'sugerir' },
          { indice: 2, precisaConfirmacao: false, precisaCadastro: false, produtoEncontrado: agua, score: 100, produtoXML: itens[2], acao: 'auto' },
          { indice: 3, precisaConfirmacao: true, produtoEncontrado: goiaba, score: 62, produtoXML: itens[3], candidatos: [{ produtoId: 904, score: 62, produto: goiaba }], acao: 'sugerir' }
        ]
      }
    }
  };
}

const esperar = () => new Promise((r) => setImmediate(r));

async function abrir(tela, extras = {}) {
  const { produtos, dadosImportacao } = dadosNota();
  const concluidos = [];
  tela.context.MiipCentralRevisao.iniciar({
    apiUrl: '/api',
    dadosImportacao,
    produtos,
    documento: { id: 264 },
    onConcluir: (r) => concluidos.push(r),
    onCancelar() {},
    ...extras
  });
  for (let i = 0; i < 5; i += 1) await esperar();
  return concluidos;
}

function telaInteira(registro) {
  return Object.values(registro).join('\n');
}

const itensDaLista = (html) => (html.match(/data-lista-idx="\d+"/g) || []).length;

describe('Revisão sem Dashboard Comercial', () => {
  test('abre sem dashboard, cartões comerciais, filtros, comparador de custos nem sugestão de preço', async () => {
    const tela = criarTela();
    await abrir(tela);
    const html = telaInteira(tela.registro);
    assert.match(html, /Conferir produtos da nota/);
    for (const texto of TEXTOS_DASHBOARD) {
      assert.equal(html.includes(texto), false, `não deve exibir "${texto}"`);
    }
  });

  test('topo mostra só a situação da conferência dos itens', async () => {
    const tela = criarTela();
    await abrir(tela);
    const topo = tela.registro['#miipCentralResumo'];
    assert.match(topo, /id="miipCentralContagens"/);
    assert.match(topo, /Itens da nota\s*<strong>4</);
    assert.match(topo, /Associados automaticamente\s*<strong>1</);
    assert.match(topo, /Precisam confirmação\s*<strong>2</);
    assert.match(topo, /Precisam cadastro\s*<strong>1</);
  });

  test('a lista mostra todos os itens pendentes mesmo com filtro comercial salvo antes', async () => {
    const tela = criarTela();
    await abrir(tela);
    const lista = tela.registro['#miipCentralLista'];
    assert.equal(itensDaLista(lista), 3);
    for (const nome of ['POLPA MARACUJA 400G', 'REFRIGERANTE COLA 2L', 'POLPA GOIABA 400G']) {
      assert.match(lista, new RegExp(nome));
    }
    assert.doesNotMatch(lista, /AGUA MINERAL/, 'item associado automaticamente não é pendência');
  });

  test('detalhe do item: produto da nota, ações e comparação de campos', async () => {
    const tela = criarTela();
    await abrir(tela);
    const det = tela.registro['#miipCentralDetalhes'];
    assert.match(det, /Produto da nota/);
    assert.match(det, /REFRIGERANTE COLA 2L/);
    assert.match(det, /data-miip-e-este="901"/);
    assert.match(det, /data-miip-acao-simples="escolher"/);
    assert.match(det, /miip-v2-linha-campo">Descrição</);
    assert.match(det, /miip-v2-linha-campo">Unidade</);
  });

  test('item sem candidato oferece Vincular produto e Cadastrar produto', async () => {
    const tela = criarTela();
    const { produtos, dadosImportacao } = dadosNota();
    dadosImportacao.miip_importacao.resultados = dadosImportacao.miip_importacao.resultados.filter((r) => r.indice !== 1 && r.indice !== 3);
    tela.context.MiipCentralRevisao.iniciar({ apiUrl: '/api', dadosImportacao, produtos, documento: { id: 264 } });
    await esperar();
    const det = tela.registro['#miipCentralDetalhes'];
    assert.match(det, /POLPA MARACUJA 400G/);
    assert.match(det, /Vincular produto/);
    assert.match(det, /Cadastrar produto/);
  });

  test('retomada: item já decidido não volta para a lista', async () => {
    const tela = criarTela();
    await abrir(tela, {
      sessaoPersistente: {
        recuperada: true,
        decisoes: [{ itemIndex: 1, decisao: 'CONFIRMAR', produtoDestinoId: 901 }],
        progresso: { concluidos: 1, total: 4, primeiroPendente: 3 }
      }
    });
    const lista = tela.registro['#miipCentralLista'];
    assert.equal(itensDaLista(lista), 2);
    assert.doesNotMatch(lista, /REFRIGERANTE COLA 2L/);
    assert.match(tela.registro['#miipCentralDetalhes'], /POLPA GOIABA 400G/);
    assert.ok(tela.notificacoes.some((n) => /Revisão retomada/.test(n.msg)));
  });

  test('confirmação de conversão aparece no painel do item, junto das ações', async () => {
    const tela = criarTela({
      conversoes: [{
        indice: 3, nItem: 4, requer_confirmacao: true, produto_nome: 'Polpa de Goiaba 400g', descricao_xml: 'POLPA GOIABA 400G',
        quantidade_comercial: 2, unidade_comercial: 'CX', unidade_estoque: 'UN', conversao_sugerida: '1 CX = 12 UN', quantidade_resultante_proposta: 24
      }]
    });
    await abrir(tela);
    assert.ok(tela.chamadas.some((c) => /\/central-entradas\/264\/revisar\/conversoes$/.test(c.url)));
    const conv = tela.elementos.miipCentralConversoes.innerHTML;
    assert.match(conv, /Conversões de unidade/);
    assert.match(conv, /miip-conv-sim/);
    assert.match(conv, /miip-conv-nao/);

    const modal = tela.registro.body;
    const painel = modal.indexOf('class="miip-central-painel"');
    const host = modal.indexOf('id="miipCentralConversoes"');
    assert.ok(painel > 0 && host > painel && host < modal.indexOf('</section>', painel), 'conversões dentro do painel do item');
  });

  test('tela final: sem resumo comercial; Finalizar Entrada leva a Compras', async () => {
    const tela = criarTela();
    const concluidos = await abrir(tela, {
      sessaoPersistente: {
        decisoes: [
          { itemIndex: 0, decisao: 'CADASTRAR', produtoDestinoId: 950 },
          { itemIndex: 1, decisao: 'CONFIRMAR', produtoDestinoId: 901 },
          { itemIndex: 3, decisao: 'CONFIRMAR', produtoDestinoId: 904 }
        ]
      }
    });
    const det = tela.registro['#miipCentralDetalhes'];
    assert.match(det, /Pronto para finalizar a entrada/);
    assert.match(det, /miipCentralBtnFinalizarEntrada/);
    for (const texto of ['Produtos Novos', 'Custo Alterado', 'Sem Cadastro']) {
      assert.equal(det.includes(texto), false, texto);
    }
    assert.equal(concluidos.length, 0, 'não finaliza sozinho');
  });

  test('concluir mantém a navegação para Compras e não mostra resumo comercial', async () => {
    const tela = criarTela();
    const { produtos, dadosImportacao } = dadosNota();
    dadosImportacao.miip_importacao.resultados = dadosImportacao.miip_importacao.resultados.filter((r) => r.indice === 2);
    const concluidos = [];
    tela.context.MiipCentralRevisao.iniciar({
      apiUrl: '/api', dadosImportacao, produtos, documento: { id: 264 }, onConcluir: (r) => concluidos.push(r)
    });
    await esperar();
    assert.equal(concluidos.length, 1);
    assert.equal(concluidos[0].navegacao.proximaAcao, 'ABRIR_COMPRA');
    assert.equal(concluidos[0].navegacao.abrirCompra, true);
    assert.ok(concluidos[0].estatisticas.inteligenciaComercial, 'dados comerciais seguem no resultado para Compras');
    assert.equal(tela.notificacoes.some((n) => /custo alterado/i.test(n.msg)), false);
  });
});

describe('Módulo comercial preservado', () => {
  test('cálculos do módulo inteligente continuam disponíveis', () => {
    const tela = criarTela();
    const I = tela.context.MiipRevisaoInteligente;
    for (const fn of ['montarSnapshot', 'montarDashboardImpacto', 'filtrarLinhas', 'montarHistoricoComercial', 'montarUltimasCompras']) {
      assert.equal(typeof I[fn], 'function', fn);
    }
  });
});
