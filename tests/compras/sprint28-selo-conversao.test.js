'use strict';

/**
 * Sprint 2.8 — SIM/NÃO de conversão só vale com o selo que o servidor emitiu para o contexto exato:
 * documento, linha do XML, produto, unidades, quantidades, conversão proposta e correções da linha.
 */

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const Confirmacao = require('../../backend/services/unidades/ConfirmacaoConversaoEntradaNfe');

const DOCUMENTO = 10;
const CABO = { id: 93, nome: 'CABO PP 2 X 2,50', unidade: 'M' };
const FIO = { id: 94, nome: 'FIO 2,50', unidade: 'M' };

function itemCabo(overrides = {}) {
  return {
    nItem: 1,
    central_item_indice: 0,
    produto_id: 93,
    produto_nome: 'CABO PP 2 X 2,50',
    quantidade_comercial: 5,
    unidade_comercial: 'CENTO',
    quantidade_tributavel: 500,
    unidade_tributavel: 'M',
    qCom: 5,
    uCom: 'CENTO',
    qTrib: 500,
    uTrib: 'M',
    subtotal: 1000,
    ...overrides
  };
}

const produtos = (...lista) => new Map((lista.length ? lista : [CABO, FIO]).map((p) => [p.id, p]));

function validar(itens, confirmacoes = [], extras = {}) {
  return Confirmacao.validarPendenciasConversaoEntrada(itens, {
    produtoMap: produtos(),
    confirmacoes,
    documentoId: DOCUMENTO,
    origemCompra: 'CENTRAL_NFE',
    ...extras
  });
}

function aplicar(itens, confirmacoes, extras = {}) {
  return Confirmacao.aplicarDecisoesNosItens(itens, {
    produtoMap: produtos(),
    confirmacoes,
    documentoId: DOCUMENTO,
    ...extras
  });
}

/** Pendência que o servidor devolve no 422 (é ela que a tela mostra no modal SIM/NÃO). */
function emitir(itens = [itemCabo()], extras = {}) {
  const pendencias = validar(itens, [], extras);
  assert.equal(pendencias.length, itens.length);
  return pendencias;
}

const decisao = (pendencia, confirmacao = true, extras = {}) => ({
  item_key: pendencia.item_key,
  indice: pendencia.indice,
  nItem: pendencia.nItem,
  documento_id: DOCUMENTO,
  confirmacao,
  selo_conversao: pendencia.selo_conversao,
  ...extras
});

describe('Sprint 2.8 — selo da confirmação de conversão', () => {
  test('confirmação válida para a linha e a conversão corretas', () => {
    const [pendencia] = emitir();
    assert.match(pendencia.selo_conversao, /^v1\.[0-9a-f]{64}$/);
    assert.equal(emitir()[0].selo_conversao, pendencia.selo_conversao, 'mesmo contexto, mesmo selo');
    assert.deepEqual(Object.keys(Confirmacao.contextoSeloConversao(pendencia)), [
      'documento_id', 'indice', 'nItem', 'revisao_produto', 'produto_id',
      'uCom', 'qCom', 'uTrib', 'qTrib', 'unidade_estoque', 'quantidade_proposta'
    ]);

    assert.deepEqual(validar([itemCabo()], [decisao(pendencia)]), []);
    const [aplicado] = aplicar([itemCabo()], [decisao(pendencia)]);
    assert.equal(aplicado.quantidade_estoque_confirmada, 500);
    assert.equal(aplicado.conversao_decisao, 'SIM');
  });

  test('campo SIM sozinho não basta: sem selo, NÃO sem selo, SIM no item e selo forjado', () => {
    const [pendencia] = emitir();
    const casos = [
      ['SIM sem selo', [decisao(pendencia, true, { selo_conversao: undefined })], [itemCabo()], 'CONFIRMACAO_CONVERSAO_SEM_SELO'],
      ['NÃO sem selo', [decisao(pendencia, false, { selo_conversao: null })], [itemCabo()], 'CONFIRMACAO_CONVERSAO_SEM_SELO'],
      ['SIM só no item', [], [itemCabo({ confirmacao: true, conversao_decisao: 'SIM' })], 'CONFIRMACAO_CONVERSAO_SEM_SELO'],
      ['selo forjado', [decisao(pendencia, true, { selo_conversao: `v1.${'0'.repeat(64)}` })], [itemCabo()], 'CONFIRMACAO_CONVERSAO_DESATUALIZADA'],
      ['selo truncado', [decisao(pendencia, true, { selo_conversao: pendencia.selo_conversao.slice(0, 20) })], [itemCabo()], 'CONFIRMACAO_CONVERSAO_DESATUALIZADA']
    ];
    for (const [rotulo, confirmacoes, itens, codigo] of casos) {
      const pendencias = validar(itens, confirmacoes);
      assert.equal(pendencias.length, 1, rotulo);
      assert.equal(pendencias[0].codigo, codigo, rotulo);
      assert.equal(pendencias[0].estado_decisao, 'PENDENTE', rotulo);
      assert.equal(pendencias[0].bloqueia_efetivacao, true, rotulo);
      assert.equal(pendencias[0].selo_conversao, pendencia.selo_conversao, `${rotulo}: servidor reapresenta a proposta`);
      assert.equal(aplicar(itens, confirmacoes)[0].quantidade_estoque_confirmada, undefined, `${rotulo}: nada aplicado`);
    }
  });

  test('confirmação ausente continua pendente com a proposta e o selo do servidor', () => {
    const [pendencia] = validar([itemCabo()], []);
    assert.equal(pendencia.estado_decisao, 'PENDENTE');
    assert.equal(pendencia.codigo, 'QTRIB_UNIDADE_ESTOQUE');
    assert.ok(pendencia.selo_conversao);
  });

  test('selo de outro contexto é recusado: documento, linha, produto, unidade, quantidade, conversão e correção', () => {
    const [original] = emitir();
    const recusar = (rotulo, itens, extras = {}, ajustarDecisao = {}) => {
      const confirmacoes = itens.map(() => decisao(original, true, ajustarDecisao));
      const pendencias = validar(itens, confirmacoes, extras);
      const alvo = pendencias.find((p) => Number(p.indice) === Number(itens[itens.length - 1].central_item_indice));
      assert.ok(alvo, `${rotulo}: linha deve continuar pendente`);
      assert.equal(alvo.codigo, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA', rotulo);
      assert.notEqual(alvo.selo_conversao, original.selo_conversao, `${rotulo}: contexto novo, selo novo`);
      const aplicados = aplicar(itens, confirmacoes, extras);
      assert.equal(aplicados[aplicados.length - 1].quantidade_estoque_confirmada, undefined, `${rotulo}: nada aplicado`);
    };

    recusar('outro documento', [itemCabo()], { documentoId: 11 }, { documento_id: 11 });
    recusar('outra linha', [itemCabo({ nItem: 2, central_item_indice: 1 })], {}, { item_key: 'linha:2', indice: 1, nItem: 2 });
    recusar('outro produto', [itemCabo({ produto_id: 94 })]);
    recusar('unidade de estoque alterada no cadastro', [itemCabo()], { produtoMap: produtos({ ...CABO, unidade: 'KG' }) });
    recusar('qCom diferente', [itemCabo({ qCom: 6, quantidade_comercial: 6 })]);
    recusar('qTrib diferente (outra quantidade convertida)', [itemCabo({ qTrib: 600, quantidade_tributavel: 600 })]);
    recusar('uCom diferente', [itemCabo({ uCom: 'CX', unidade_comercial: 'CX' })]);
    recusar('uTrib diferente (outra conversão)', [itemCabo({ uTrib: 'UN', unidade_tributavel: 'UN' })]);
    recusar('produto da linha corrigido depois da confirmação', [itemCabo({ revisao_produto_linha: 1 })]);
  });

  test('decisão que se declara de outra nota continua recusada como nota errada', () => {
    const [pendencia] = emitir();
    const [recusa] = validar([itemCabo()], [decisao(pendencia, true, { documento_id: 99 })]);
    assert.equal(recusa.codigo, 'DECISAO_NOTA_INCORRETA');
  });

  test('reconciliação: correções da linha vêm do documento e o selo enviado no item é descartado', () => {
    const documento = {
      id: DOCUMENTO,
      itens: [{ nItem: 1, uCom: 'CENTO', qCom: 5, uTrib: 'M', qTrib: 500, correcoes_produto: [{}, {}] }]
    };
    const { ok, itens } = Confirmacao.reconciliarItensComDocumentoCentral([
      itemCabo({ revisao_produto_linha: 0, correcoes_produto: [], selo_conversao: 'v1.qualquer' })
    ], documento);
    assert.equal(ok, true);
    assert.equal(itens[0].revisao_produto_linha, 2);
    assert.equal(itens[0].selo_conversao, undefined);
  });
});
