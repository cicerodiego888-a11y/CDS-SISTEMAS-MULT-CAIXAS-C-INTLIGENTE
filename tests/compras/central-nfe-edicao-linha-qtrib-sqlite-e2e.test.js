'use strict';

/**
 * Sprint 4 — qTrib/uTrib da NF-e sobrevivem à edição da linha da Central.
 *
 * NF-e → Central → tela de Compras → EDITAR linha → "Salvar alterações" (sem mudar nada)
 * → saveCompra → POST /api/compras real → SQLite.
 */

const {
  getDb,
  allDb,
  runDb,
  criarCentral,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const FARDO = {
  uCom: 'FD', qCom: 100, vUnCom: 43.9,
  unidadeEstoque: 'UN',
  precoVenda: 5.92
};
const ESPERADO_FARDO = { quantidade: 1000, custo: 4.39, subtotal: 4390, margem: 25.84 };

const CASOS = [
  {
    ...FARDO, uTrib: 'UN', qTrib: 1000, vUnTrib: 4.39,
    apresentacao: null,
    id: 9401, nf: 9401,
    rotulo: 'FARDO sem embalagem cadastrada, qTrib em UN',
    codigo: 'SPRINT4-FD-SEMEMB', gtin: '7891234594017',
    nome: 'BISCOITO SPRINT4 FARDO 10UN',
    esperado: ESPERADO_FARDO
  },
  {
    ...FARDO, uTrib: 'UN', qTrib: 1000, vUnTrib: 4.39,
    apresentacao: { tipo: 'FD', quantidade: 10 },
    id: 9402, nf: 9402,
    rotulo: 'FARDO com embalagem FD×10, qTrib em UN',
    codigo: 'SPRINT4-FD-UN', gtin: '7891234594024',
    nome: 'ACUCAR SPRINT4 FARDO 10X1KG',
    esperado: ESPERADO_FARDO
  },
  {
    ...FARDO, uTrib: 'FD', qTrib: 100, vUnTrib: 43.9,
    apresentacao: { tipo: 'FD', quantidade: 10 },
    id: 9403, nf: 9403,
    rotulo: 'FARDO com embalagem FD×10, qTrib em FD',
    codigo: 'SPRINT4-FD-FD', gtin: '7891234594031',
    nome: 'CAFE SPRINT4 FARDO 10X500G',
    esperado: ESPERADO_FARDO
  },
  {
    uCom: 'CX', qCom: 10, vUnCom: 120,
    uTrib: 'UN', qTrib: 120, vUnTrib: 10,
    apresentacao: { tipo: 'CX', quantidade: 12 },
    unidadeEstoque: 'UN',
    precoVenda: 12.5,
    id: 9404, nf: 9404,
    rotulo: 'CAIXA com embalagem CX×12, qTrib em UN',
    codigo: 'SPRINT4-CX', gtin: '7891234594048',
    nome: 'LEITE SPRINT4 CAIXA 12UN',
    esperado: { quantidade: 120, custo: 10, subtotal: 1200, margem: 20 }
  },
  {
    uCom: 'UN', qCom: 20, vUnCom: 5,
    uTrib: 'UN', qTrib: 20, vUnTrib: 5,
    apresentacao: null,
    unidadeEstoque: 'UN',
    precoVenda: 6,
    id: 9405, nf: 9405,
    rotulo: 'UN simples',
    codigo: 'SPRINT4-UN', gtin: '7891234594055',
    nome: 'ESCOVA SPRINT4 UNIDADE',
    esperado: { quantidade: 20, custo: 5, subtotal: 100, margem: 16.67 }
  }
];

const SALDO_FISCAL_INICIAL = 30;
const SALDO_NAO_FISCAL_INICIAL = 7;

async function cadastrarProduto(caso) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [caso.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [caso.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, ?, ?, ?, 4, ?, ?, 0, 0, ?, ?, ?, 1, NULL, 'Fornecedor Sprint 4', 1)`,
    [
      caso.id, caso.nome, caso.unidadeEstoque,
      caso.apresentacao ? caso.apresentacao.tipo : caso.unidadeEstoque,
      caso.apresentacao ? caso.apresentacao.quantidade : 1,
      caso.precoVenda,
      SALDO_FISCAL_INICIAL + SALDO_NAO_FISCAL_INICIAL,
      SALDO_FISCAL_INICIAL, SALDO_NAO_FISCAL_INICIAL,
      caso.codigo
    ]
  );
  if (caso.apresentacao) {
    await runDb(
      `INSERT INTO produto_embalagens (
        produto_id, tipo, quantidade, unidade, principal, compra, venda, estoque, ativa
      ) VALUES (?, ?, ?, ?, 1, 1, 1, 1, 1)`,
      [caso.id, caso.apresentacao.tipo, caso.apresentacao.quantidade, caso.unidadeEstoque]
    );
  }
}

async function editarLinhaSemAlterar(pagina) {
  pagina.context.editarItemCompra(0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await pagina.context.adicionarItemCompraAsync();
  assert.equal(pagina.avaliar('indiceEditandoCompra'), null, 'edição deve ser confirmada');
  return JSON.parse(JSON.stringify(pagina.avaliar('itensCompraAtual')));
}

test('Sprint 4 — EDITAR linha da Central preserva qTrib/uTrib até o SQLite', async (t) => {
  const { app, central } = await criarCentral();

  for (const caso of CASOS) {
    await t.test(caso.rotulo, async () => {
      await cadastrarProduto(caso);
      const recebimento = await receberPelaCentral(central, caso, { decisao: 'ASSOCIAR', produtoId: caso.id });

      let itensEditados = null;
      const { itensTela, gravacao } = await lancarCompraPelaTela(app, recebimento, {
        antesDeGravar: async (pagina) => { itensEditados = await editarLinhaSemAlterar(pagina); }
      });
      const esperado = caso.esperado;
      assert.equal(Number(itensTela[0].quantidade_convertida), esperado.quantidade, 'tela antes de editar: quantidade');

      assert.equal(itensEditados.length, 1, 'edição não pode duplicar a linha');
      const editado = itensEditados[0];
      assert.equal(Number(editado.quantidade_convertida), esperado.quantidade, 'tela após editar: quantidade');
      assert.equal(Number(editado.quantidade_tributavel_nfe), caso.qTrib, 'tela após editar: qTrib do XML');
      assert.equal(String(editado.unidade_tributavel_nfe).toUpperCase(), caso.uTrib, 'tela após editar: uTrib do XML');

      assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
      const itemPayload = gravacao.corpo.itens[0];
      assert.equal(Number(itemPayload.quantidade_tributavel), caso.qTrib, 'payload: quantidade_tributavel');
      assert.equal(String(itemPayload.unidade_tributavel).toUpperCase(), caso.uTrib, 'payload: unidade_tributavel');
      assert.equal(Number(itemPayload.quantidade), esperado.quantidade, 'payload: quantidade');
      assert.equal(Number(itemPayload.custo_unitario_final), esperado.custo, 'payload: custo unitário');
      assert.equal(Number(itemPayload.subtotal), esperado.subtotal, 'payload: subtotal');

      const compraId = Number(gravacao.resposta.body.id);
      const itens = await allDb('SELECT * FROM compras_itens WHERE compra_id = ?', [compraId]);
      assert.equal(itens.length, 1, 'compras_itens: um item');
      assert.equal(Number(itens[0].quantidade), esperado.quantidade, 'compras_itens.quantidade');
      assert.equal(Number(itens[0].quantidade_fiscal), esperado.quantidade, 'compras_itens.quantidade_fiscal');
      assert.equal(Number(itens[0].custo_unitario_final), esperado.custo, 'compras_itens.custo_unitario_final');
      assert.equal(Number(itens[0].subtotal), esperado.subtotal, 'compras_itens.subtotal');
      assert.equal(Number(itens[0].margem_lucro), esperado.margem, 'compras_itens.margem_lucro');

      const produto = await getDb(
        'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_compra FROM produtos WHERE id = ?',
        [caso.id]
      );
      assert.equal(Number(produto.saldo_fiscal), SALDO_FISCAL_INICIAL + esperado.quantidade, 'produtos.saldo_fiscal');
      assert.equal(Number(produto.saldo_nao_fiscal), SALDO_NAO_FISCAL_INICIAL, 'produtos.saldo_nao_fiscal preservado');
      assert.equal(
        Number(produto.estoque_atual),
        SALDO_FISCAL_INICIAL + SALDO_NAO_FISCAL_INICIAL + esperado.quantidade,
        'produtos.estoque_atual'
      );
      assert.equal(Number(produto.preco_compra), esperado.custo, 'produtos.preco_compra');
    });
  }

  await t.test('fator cadastrado diverge do qTrib: EDITAR não pode burlar o bloqueio do backend', async () => {
    const caso = {
      ...FARDO, uTrib: 'UN', qTrib: 1000, vUnTrib: 4.39,
      apresentacao: { tipo: 'FD', quantidade: 12 },
      id: 9406, nf: 9406,
      codigo: 'SPRINT4-FD-DIVERG', gtin: '7891234594062',
      nome: 'ARROZ SPRINT4 FARDO DIVERGENTE'
    };
    await cadastrarProduto(caso);
    const recebimento = await receberPelaCentral(central, caso, { decisao: 'ASSOCIAR', produtoId: caso.id });

    await assert.rejects(
      lancarCompraPelaTela(app, recebimento, { antesDeGravar: editarLinhaSemAlterar }),
      /qTrib \(1000 UN\) diverge da conversão cadastrada \(1200 UN\)/
    );
    const itens = await allDb('SELECT id FROM compras_itens WHERE produto_id = ?', [caso.id]);
    assert.equal(itens.length, 0, 'compra divergente não pode ser gravada');
    const produto = await getDb('SELECT saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?', [caso.id]);
    assert.equal(Number(produto.saldo_fiscal), SALDO_FISCAL_INICIAL, 'saldo fiscal intacto');
    assert.equal(Number(produto.saldo_nao_fiscal), SALDO_NAO_FISCAL_INICIAL, 'saldo não fiscal intacto');
  });
});
