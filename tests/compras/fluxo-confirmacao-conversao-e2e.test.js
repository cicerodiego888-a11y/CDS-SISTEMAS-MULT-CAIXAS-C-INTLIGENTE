'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { criarPaginaCompras } = require('./helpers/centralNfeE2eHarness');
const comprasRouter = require('../../backend/rotas/compras');
const confirmacaoFrontend = require('../../frontend/erp/js/compras-confirmacao-conversao');

const {
  normalizarDecisaoConversaoEntrada,
  validarPendenciasConversaoEntrada,
  normalizarDecisoesConversaoEntrada,
  aplicarDecisoesNosItens,
  quantidadeAutorizadaEntradaNfe
} = comprasRouter;

const produtoMap = new Map([
  [93, { id: 93, nome: 'CABO PP 2 X 2,50', unidade: 'M' }],
  [94, { id: 94, nome: 'Fio elétrico', unidade: 'M' }]
]);

function itemPendenciaBase(produtoId, overrides = {}) {
  return {
    produto_id: produtoId,
    produto_nome: `Produto ${produtoId}`,
    quantidade_comercial: 5,
    unidade_comercial: 'CENTO',
    unidade_tributavel: 'M',
    quantidade_tributavel: 500,
    qCom: 5,
    uCom: 'CENTO',
    qTrib: 500,
    uTrib: 'M',
    ...overrides
  };
}

test('normaliza decisão conforme regra false != null', () => {
  assert.strictEqual(normalizarDecisaoConversaoEntrada(true), true);
  assert.strictEqual(normalizarDecisaoConversaoEntrada(false), false);
  assert.strictEqual(normalizarDecisaoConversaoEntrada(null), null);
  assert.strictEqual(normalizarDecisaoConversaoEntrada('false'), false);
  assert.strictEqual(normalizarDecisaoConversaoEntrada('null'), null);
  assert.strictEqual(normalizarDecisaoConversaoEntrada('SIM'), true);
});

test('pendências ficam abertas quando a decisão é null ou ausente', () => {
  const itens = [itemPendenciaBase(93), itemPendenciaBase(94)];
  const pendencias = validarPendenciasConversaoEntrada(itens, { produtoMap, origemCompra: 'CENTRAL_NFE' });
  assert.equal(pendencias.length, 2);
  assert.ok(pendencias.every((item) => item.requer_confirmacao === true));
});

test('false recusa a conversão e bloqueia se não houver quantidade segura', () => {
  const itens = [itemPendenciaBase(93), itemPendenciaBase(94)];
  const pendencias = validarPendenciasConversaoEntrada(itens, {
    produtoMap,
    origemCompra: 'CENTRAL_NFE',
    confirmacoes: {
      'produto:93:idx:0': false,
      'produto:94:idx:1': false
    }
  });
  assert.equal(pendencias.length, 2);
  assert.ok(pendencias.every((item) => item.codigo === 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA'));
});

test('continuar sem conversão mantém compra pendente de estoque sem autorizar quantidade', () => {
  const itens = [itemPendenciaBase(93)];
  const confirmacoes = {
    'produto:93:idx:0': { confirmacao: false, continuar_sem_conversao: true }
  };
  assert.deepEqual(validarPendenciasConversaoEntrada(itens, {
    produtoMap,
    origemCompra: 'CENTRAL_NFE',
    confirmacoes
  }), []);

  const aplicados = aplicarDecisoesNosItens(itens, {
    produtoMap,
    confirmacoes
  });
  assert.equal(aplicados[0].estoque_pendente_conversao, true);
  assert.equal(aplicados[0].conversao_aplicada, false);
  assert.equal(JSON.parse(aplicados[0].pendencia_estoque_json).xml_original.qCom, 5);
  assert.deepEqual(quantidadeAutorizadaEntradaNfe(aplicados[0], produtoMap.get(93)), {
    estado: 'PENDENTE_CONVERSAO',
    quantidade: null
  });
});

test('true resolve pendência sem bloquear a gravação', () => {
  const itens = [itemPendenciaBase(93)];
  const pendencias = validarPendenciasConversaoEntrada(itens, {
    produtoMap,
    origemCompra: 'CENTRAL_NFE',
    confirmacoes: { 'produto:93:idx:0': true }
  });
  assert.deepStrictEqual(pendencias, []);
});

test('mesmo produto em duas linhas usa chave por item para decisões independentes', () => {
  const itens = [
    itemPendenciaBase(93, { item_id: 101, linha_id: 'lin-1' }),
    itemPendenciaBase(93, { item_id: 102, linha_id: 'lin-2' })
  ];
  const pendencias = validarPendenciasConversaoEntrada(itens, {
    produtoMap,
    origemCompra: 'CENTRAL_NFE',
    confirmacoes: [
      { linha_id: 'lin-1', confirmacao: true },
      { linha_id: 'lin-2', confirmacao: true }
    ]
  });
  assert.deepStrictEqual(pendencias, []);
});

test('normalizador de decisões aceita um array e preserva chave por linha', () => {
  const mapa = normalizarDecisoesConversaoEntrada([
    { item_id: 11, confirmacao: false },
    { item_id: 12, confirmacao: null }
  ], [
    { item_id: 11 },
    { item_id: 12 }
  ]);
  assert.strictEqual(mapa.get('item:11').confirmacao, false);
  assert.strictEqual(mapa.get('item:12').confirmacao, null);
});

test('modal real registra SIM e NÃO por item_key e envia identidade original da linha', async () => {
  const recebidos = [];
  const app = express();
  app.use(express.json());
  app.post('/api/compras', (req, res) => {
    recebidos.push(req.body);
    res.json({ id: 123, message: 'Compra registrada.' });
  });
  const pagina = criarPaginaCompras(app);
  const payloadOriginal = {
    central_documento_id: 77,
    chave_acesso: '35261011222333000181550010000000011000000010',
    xml: '<NFe>fixture</NFe>',
    itens: [
      { item_key: 'linha:8', nItem: 8, central_item_indice: 0, produto_id: 93, quantidade: 5 },
      { item_key: 'linha:3', nItem: 3, central_item_indice: 4, produto_id: 94, quantidade: 2 }
    ],
    confirmacoes_conversao: []
  };
  const pendencias = [
    { item_key: 'linha:3', indice: 4, central_item_indice: 4, nItem: 3, documento_id: 77, selo_conversao: 'selo-3' },
    { item_key: 'linha:8', indice: 0, central_item_indice: 0, nItem: 8, documento_id: 77, selo_conversao: 'selo-8' }
  ];

  pagina.avaliar(`abrirModalConfirmacaoConversaoPendencias(
    ${JSON.stringify(pendencias)},
    ${JSON.stringify(payloadOriginal)},
    false,
    false
  )`);
  assert.equal(pagina.prop('#confirmacaoConversaoUnidadesModal-confirmar', 'disabled'), true);

  pagina.clicar('#confirmacaoConversaoUnidadesModal', {
    dataset: { itemKey: 'linha:3', decisao: 'true' }
  });
  assert.equal(pagina.prop('#confirmacaoConversaoUnidadesModal-confirmar', 'disabled'), true);
  pagina.clicar('#confirmacaoConversaoUnidadesModal', {
    dataset: { itemKey: 'linha:8', decisao: false }
  });
  assert.equal(pagina.prop('#confirmacaoConversaoUnidadesModal-confirmar', 'disabled'), false);
  pagina.clicar('#confirmacaoConversaoUnidadesModal-confirmar');

  for (let tentativa = 0; tentativa < 100 && recebidos.length === 0; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(recebidos.length, 1, 'uma confirmação deve causar somente um POST');
  assert.equal(recebidos[0].xml, payloadOriginal.xml);
  assert.deepEqual(recebidos[0].itens, payloadOriginal.itens);
  assert.equal(recebidos[0].chave_acesso, payloadOriginal.chave_acesso);
  assert.deepEqual(recebidos[0].confirmacoes_conversao.map((item) => ({
    item_key: item.item_key,
    indice: item.indice,
    nItem: item.nItem,
    documento_id: item.documento_id,
    chave_acesso: item.chave_acesso,
    confirmacao: item.confirmacao,
    selo_conversao: item.selo_conversao
  })), [
    { item_key: 'linha:3', indice: 4, nItem: 3, documento_id: 77, chave_acesso: payloadOriginal.chave_acesso, confirmacao: true, selo_conversao: 'selo-3' },
    { item_key: 'linha:8', indice: 0, nItem: 8, documento_id: 77, chave_acesso: payloadOriginal.chave_acesso, confirmacao: false, selo_conversao: 'selo-8' }
  ]);
});

test('modal envia escolha de continuar sem conversão com identidade original e um POST', async () => {
  const recebidos = [];
  const app = express();
  app.use(express.json());
  app.post('/api/compras', (req, res) => {
    recebidos.push(req.body);
    res.json({ id: 124, message: 'Compra registrada com estoque pendente.' });
  });
  const pagina = criarPaginaCompras(app);
  const payloadOriginal = {
    central_documento_id: 77,
    chave_acesso: '35261011222333000181550010000000011000000010',
    xml: '<NFe>fixture</NFe>',
    itens: [{ item_key: 'linha:8', nItem: 8, central_item_indice: 0, produto_id: 93, qCom: 5, uCom: 'PCT' }]
  };
  pagina.avaliar(`abrirModalConfirmacaoConversaoPendencias(
    ${JSON.stringify([{ item_key: 'linha:8', indice: 0, central_item_indice: 0, nItem: 8, documento_id: 77, selo_conversao: 'selo-8' }])},
    ${JSON.stringify(payloadOriginal)},
    false,
    false
  )`);
  pagina.clicar('#confirmacaoConversaoUnidadesModal', {
    dataset: { itemKey: 'linha:8', decisao: 'sem-conversao' }
  });
  assert.equal(pagina.prop('#confirmacaoConversaoUnidadesModal-confirmar', 'disabled'), false);
  pagina.clicar('#confirmacaoConversaoUnidadesModal-confirmar');

  for (let tentativa = 0; tentativa < 100 && recebidos.length === 0; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0].xml, payloadOriginal.xml);
  assert.equal(recebidos[0].chave_acesso, payloadOriginal.chave_acesso);
  assert.equal(recebidos[0].confirmacoes_conversao[0].confirmacao, false);
  assert.equal(recebidos[0].confirmacoes_conversao[0].continuar_sem_conversao, true);
  assert.equal(recebidos[0].confirmacoes_conversao[0].nItem, 8);
  assert.equal(recebidos[0].confirmacoes_conversao[0].selo_conversao, 'selo-8');
});

test('422 só reabre para pendências respondíveis e explica rejeições de identidade, selo e quantidade', () => {
  const primeiraPendencia = confirmacaoFrontend.classificarResposta422({
    code: 'PENDENCIAS_CONVERSAO',
    error: 'Há itens com conversão de unidade pendente de confirmação.',
    pendencias: [{ estado_decisao: 'PENDENTE', codigo: 'QTRIB_UNIDADE_ESTOQUE' }]
  });
  assert.equal(primeiraPendencia.reabrirModal, true);
  for (const codigo of ['DIVERGENCIA_QTRIB_FATOR', 'FATOR_CONVERSAO_AUSENTE']) {
    assert.equal(confirmacaoFrontend.classificarResposta422({
      code: 'PENDENCIAS_CONVERSAO',
      error: 'Há itens que precisam de revisão.',
      pendencias: [{ estado_decisao: 'PENDENTE', codigo }]
    }).reabrirModal, true, `${codigo} deve permitir uma decisão explícita`);
  }

  for (const codigo of [
    'DECISAO_NOTA_INCORRETA',
    'DECISAO_LINHA_INCORRETA',
    'CONFIRMACAO_CONVERSAO_SEM_SELO',
    'CONFIRMACAO_CONVERSAO_DESATUALIZADA',
    'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA',
    'CONVERSAO_EFETIVA_DIVERGENTE'
  ]) {
    const resultado = confirmacaoFrontend.classificarResposta422({
      code: 'PENDENCIAS_CONVERSAO',
      error: 'A validação da conversão falhou.',
      pendencias: [{ estado_decisao: 'PENDENTE', codigo }]
    });
    assert.equal(resultado.reabrirModal, false, codigo);
    assert.match(resultado.mensagem, /A validação da conversão falhou\./);
  }
  assert.match(
    confirmacaoFrontend.classificarResposta422({
      code: 'PENDENCIAS_CONVERSAO',
      error: 'Conversão recusada.',
      pendencias: [{ codigo: 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA' }]
    }).mensagem,
    /não há quantidade segura/
  );
  assert.match(
    confirmacaoFrontend.classificarResposta422({
      code: 'PENDENCIAS_CONVERSAO',
      error: 'A validação da conversão falhou.',
      pendencias: [{ codigo: 'DIVERGENCIA_QTRIB_FATOR' }]
    }).mensagem,
    /diverge do fator cadastrado/
  );
});

test('422 de selo/identidade mostra o motivo sem reabrir o modal nem repetir o POST', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/compras', (_req, res) => res.status(422).json({
    code: 'PENDENCIAS_CONVERSAO',
    error: 'Há itens com conversão de unidade pendente de confirmação.',
    pendencias: [{
      item_key: 'linha:3',
      estado_decisao: 'PENDENTE',
      codigo: 'CONFIRMACAO_CONVERSAO_DESATUALIZADA'
    }]
  }));
  const pagina = criarPaginaCompras(app);
  const payload = {
    central_documento_id: 77,
    chave_acesso: '35261011222333000181550010000000011000000010',
    xml: '<NFe>fixture</NFe>',
    itens: [{ nItem: 3, central_item_indice: 4, produto_id: 94 }]
  };

  pagina.avaliar(`executarGravacaoCompra(${JSON.stringify(payload)}, false, false)`);
  pagina.avaliar(`executarGravacaoCompra(${JSON.stringify(payload)}, false, false)`);
  for (let tentativa = 0; tentativa < 100 && pagina.requisicoes.length === 0; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  for (let tentativa = 0; tentativa < 100 && pagina.notificacoes.length === 0; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(pagina.requisicoes.filter((req) => req.metodo === 'POST').length, 1);
  assert.equal(pagina.htmlAnexados.some((html) => html.includes('confirmacaoConversaoUnidadesModal')), false);
  assert.match(pagina.notificacoes[0].mensagem, /mudou/);
  assert.match(pagina.notificacoes[0].mensagem, /Há itens com conversão/);
});

test('payload confirmado conserva nota, itens e decisões de linhas não reapresentadas', () => {
  const original = {
    central_documento_id: 77,
    chave_acesso: '35261011222333000181550010000000011000000010',
    xml: '<NFe>integral</NFe>',
    itens: [{ nItem: 9, central_item_indice: 7, campo_original: 'preservar' }],
    confirmacoes_conversao: [
      { item_key: 'linha:2', nItem: 2, documento_id: 77, confirmacao: true, selo_conversao: 'validado' }
    ]
  };
  const payload = confirmacaoFrontend.construirPayloadConfirmado(
    original,
    [{ item_key: 'linha:9', indice: 7, nItem: 9, documento_id: 77, selo_conversao: 'novo' }],
    new Map([['linha:9', false]]),
    77
  );
  assert.equal(payload.xml, original.xml);
  assert.deepEqual(payload.itens, original.itens);
  assert.deepEqual(payload.confirmacoes_conversao.map((item) => item.item_key), ['linha:2', 'linha:9']);
  assert.equal(payload.confirmacoes_conversao[1].central_item_indice, 7);
  assert.equal(payload.confirmacoes_conversao[1].chave_acesso, original.chave_acesso);
  assert.equal(payload.confirmacoes_conversao[1].confirmacao, false);
});
