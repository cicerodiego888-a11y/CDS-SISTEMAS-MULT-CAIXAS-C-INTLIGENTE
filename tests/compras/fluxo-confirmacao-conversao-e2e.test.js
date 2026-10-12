'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const comprasRouter = require('../../backend/rotas/compras');

const {
  normalizarDecisaoConversaoEntrada,
  validarPendenciasConversaoEntrada,
  normalizarDecisoesConversaoEntrada
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
