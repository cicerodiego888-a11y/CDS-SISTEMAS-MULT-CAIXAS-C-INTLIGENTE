'use strict';

/**
 * Sprint 2 — persistência real da entrada NF-e pela Central.
 *
 * XML → Central (upload, revisão, finalizar) → tela de Compras real (compras.js inteiro)
 * → POST /api/compras real → SQLite (compras, compras_itens, produtos).
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

const CASOS = [
  {
    id: 9201,
    nf: 9201,
    rotulo: 'FARDO (qTrib em UN)',
    codigo: 'SPRINT2-FD-UN',
    gtin: '7891234592013',
    nome: 'ARROZ SPRINT2 FARDO 10X1KG',
    unidadeEstoque: 'UN',
    apresentacao: { tipo: 'FD', quantidade: 10 },
    uCom: 'FD', qCom: 100, vUnCom: 43.9,
    uTrib: 'UN', qTrib: 1000, vUnTrib: 4.39,
    custoAnterior: 4.38, precoVenda: 5.92, saldoInicial: 5,
    esperado: { quantidade: 1000, custo: 4.39, subtotal: 4390, margem: 25.84, embalagens: 100, fator: 10 }
  },
  {
    id: 9202,
    nf: 9202,
    rotulo: 'FARDO (qTrib/vUnTrib na unidade comercial)',
    codigo: 'SPRINT2-FD-FD',
    gtin: '7891234592020',
    nome: 'FEIJAO SPRINT2 FARDO 10X1KG',
    unidadeEstoque: 'UN',
    apresentacao: { tipo: 'FD', quantidade: 10 },
    uCom: 'FD', qCom: 100, vUnCom: 43.9,
    uTrib: 'FD', qTrib: 100, vUnTrib: 43.9,
    custoAnterior: 4.38, precoVenda: 5.92, saldoInicial: 5,
    esperado: { quantidade: 1000, custo: 4.39, subtotal: 4390, margem: 25.84, embalagens: 100, fator: 10 }
  },
  {
    id: 9203,
    nf: 9203,
    rotulo: 'ROLO',
    codigo: 'SPRINT2-ROLO',
    gtin: '7891234592037',
    nome: 'CABO SPRINT2 ROLO 100M',
    unidadeEstoque: 'MT',
    apresentacao: { tipo: 'ROLO', quantidade: 100 },
    uCom: 'ROLO', qCom: 1, vUnCom: 100,
    uTrib: 'ROLO', qTrib: 1, vUnTrib: 100,
    custoAnterior: 0.9, precoVenda: 1.5, saldoInicial: 5,
    esperado: { quantidade: 100, custo: 1, subtotal: 100, margem: 33.33, embalagens: 1, fator: 100 }
  },
  {
    id: 9204,
    nf: 9204,
    rotulo: 'CAIXA',
    codigo: 'SPRINT2-CX',
    gtin: '7891234592044',
    nome: 'OLEO SPRINT2 CAIXA 12UN',
    unidadeEstoque: 'UN',
    apresentacao: { tipo: 'CX', quantidade: 12 },
    uCom: 'CX', qCom: 10, vUnCom: 120,
    uTrib: 'UN', qTrib: 120, vUnTrib: 10,
    custoAnterior: 9.5, precoVenda: 12.5, saldoInicial: 5,
    esperado: { quantidade: 120, custo: 10, subtotal: 1200, margem: 20, embalagens: 10, fator: 12 }
  },
  {
    id: 9205,
    nf: 9205,
    rotulo: 'UN',
    codigo: 'SPRINT2-UN',
    gtin: '7891234592051',
    nome: 'SABONETE SPRINT2 UNIDADE',
    unidadeEstoque: 'UN',
    apresentacao: null,
    uCom: 'UN', qCom: 20, vUnCom: 5,
    uTrib: 'UN', qTrib: 20, vUnTrib: 5,
    custoAnterior: 4.8, precoVenda: 6, saldoInicial: 5,
    esperado: { quantidade: 20, custo: 5, subtotal: 100, margem: 16.67, embalagens: 20, fator: null }
  }
];

async function cadastrarProduto(caso) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [caso.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [caso.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, 1, ?, 'Fornecedor Sprint 2', 1)`,
    [
      caso.id, caso.nome, caso.unidadeEstoque,
      caso.apresentacao ? caso.apresentacao.tipo : caso.unidadeEstoque,
      caso.apresentacao ? caso.apresentacao.quantidade : 1,
      caso.custoAnterior, caso.precoVenda, caso.saldoInicial, caso.saldoInicial,
      caso.codigo, caso.gtin
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

test('Sprint 2 — entrada NF-e pela Central persiste quantidade de estoque e custo unitário no SQLite', async (t) => {
  const { app, central } = await criarCentral();

  for (const caso of CASOS) {
    await t.test(caso.rotulo, async () => {
      await cadastrarProduto(caso);
      const esperado = caso.esperado;
      const recebimento = await receberPelaCentral(central, caso);

      const itemCentral = recebimento.dadosCompra.itens[0];
      assert.equal(recebimento.dadosCompra.itens.length, 1);
      assert.equal(Number(itemCentral.produto_id), caso.id, 'Central deve entregar o produto associado na revisão');
      assert.equal(Number(itemCentral.quantidade_comercial ?? itemCentral.quantidade ?? itemCentral.qCom), caso.qCom);

      const { itensTela, custoTela, gravacao } = await lancarCompraPelaTela(app, recebimento);

      // Tela (Central NF-e) — conversão e custo canônico
      assert.equal(itensTela.length, 1);
      assert.equal(Number(itensTela[0].quantidade_convertida), esperado.quantidade, 'tela: quantidade de estoque');
      assert.equal(Number(custoTela[0]), esperado.custo, 'tela: custo unitário canônico');
      assert.equal(Number(itensTela[0].subtotal), esperado.subtotal, 'tela: subtotal');

      // Payload real enviado pela tela
      assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
      assert.equal(gravacao.corpo.origem_compra, 'CENTRAL_NFE');
      assert.equal(Number(gravacao.corpo.central_documento_id), recebimento.documentoId);
      const itemPayload = gravacao.corpo.itens[0];
      assert.equal(Number(itemPayload.produto_id), caso.id);
      assert.equal(Number(itemPayload.quantidade), esperado.quantidade, 'payload: quantidade');
      assert.equal(Number(itemPayload.quantidade_fiscal), esperado.quantidade, 'payload: quantidade fiscal');
      assert.equal(Number(itemPayload.quantidade_nao_fiscal), 0, 'payload: quantidade não fiscal');
      assert.equal(Number(itemPayload.custo_unitario_final), esperado.custo, 'payload: custo unitário');
      assert.equal(Number(itemPayload.subtotal), esperado.subtotal, 'payload: subtotal');
      assert.equal(Number(itemPayload.precoVendaAtual), caso.precoVenda, 'payload: preço de venda inalterado');
      assert.equal(itemPayload.precoVendaAlteradoManualmente, false);

      // SQLite — compra
      const compraId = Number(gravacao.resposta.body.id);
      assert.ok(compraId > 0);
      const compra = await getDb('SELECT * FROM compras WHERE id = ?', [compraId]);
      assert.ok(compra, 'cabeçalho da compra persistido');
      assert.equal(Number(compra.total ?? compra.valor_total), esperado.subtotal, 'compras.total');

      const itens = await allDb('SELECT * FROM compras_itens WHERE compra_id = ?', [compraId]);
      assert.equal(itens.length, 1, 'um item persistido');
      const item = itens[0];
      assert.equal(Number(item.produto_id), caso.id);
      assert.equal(Number(item.quantidade), esperado.quantidade, 'compras_itens.quantidade');
      assert.equal(Number(item.quantidade_fiscal), esperado.quantidade, 'compras_itens.quantidade_fiscal');
      assert.equal(Number(item.quantidade_nao_fiscal), 0, 'compras_itens.quantidade_nao_fiscal');
      assert.equal(Number(item.peso_total_compra), esperado.quantidade, 'compras_itens.peso_total_compra');
      assert.equal(Number(item.custo_unitario_final), esperado.custo, 'compras_itens.custo_unitario_final');
      assert.equal(Number(item.preco_unitario), esperado.custo, 'compras_itens.preco_unitario');
      assert.equal(Number(item.subtotal), esperado.subtotal, 'compras_itens.subtotal');
      assert.equal(String(item.unidade).toUpperCase(), caso.unidadeEstoque, 'compras_itens.unidade');
      assert.equal(Number(item.quantidade_embalagens), esperado.embalagens, 'compras_itens.quantidade_embalagens');
      if (esperado.fator != null) {
        assert.equal(Number(item.quantidade_por_embalagem), esperado.fator, 'compras_itens.quantidade_por_embalagem');
      }
      assert.equal(Number(item.preco_venda_sugerido), caso.precoVenda, 'compras_itens.preco_venda_sugerido');
      assert.equal(Number(item.atualizar_preco_venda), 0, 'compras_itens.atualizar_preco_venda');
      assert.equal(Number(item.margem_lucro), esperado.margem, 'compras_itens.margem_lucro');

      // SQLite — estoque fiscal do produto
      const produto = await getDb(
        `SELECT unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_compra, preco_venda
         FROM produtos WHERE id = ?`,
        [caso.id]
      );
      assert.equal(Number(produto.saldo_fiscal), caso.saldoInicial + esperado.quantidade, 'produtos.saldo_fiscal');
      assert.equal(Number(produto.saldo_nao_fiscal), 0, 'produtos.saldo_nao_fiscal');
      assert.equal(Number(produto.estoque_atual), caso.saldoInicial + esperado.quantidade, 'produtos.estoque_atual');
      assert.equal(Number(produto.preco_compra), esperado.custo, 'produtos.preco_compra');
      assert.equal(Number(produto.preco_venda), caso.precoVenda, 'produtos.preco_venda não muda');
      assert.equal(String(produto.unidade).toUpperCase(), caso.unidadeEstoque, 'produtos.unidade');
    });
  }
});
