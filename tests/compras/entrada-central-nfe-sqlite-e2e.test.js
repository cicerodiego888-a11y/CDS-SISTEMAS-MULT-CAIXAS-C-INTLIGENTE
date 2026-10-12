'use strict';

const assert = require('assert/strict');
const { test } = require('node:test');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-central-nfe-sprint1g-'));
process.env.DB_DIR = dbDir;
delete require.cache[require.resolve('../../backend/database')];

const db = require('../../backend/database');
const { DocumentoFiscalStatus, normalizarStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbReady() {
  return new Promise((resolve, reject) => {
    db.whenReady((err) => err ? reject(err) : resolve());
  });
}

function waitForStockReconciliation() {
  return new Promise((resolve, reject) => {
    const check = () => db.get(
      'SELECT valor FROM configuracoes WHERE chave = ?',
      ['migracao_recalc_saldos_estoque_v1'],
      (err, row) => {
        if (err) return reject(err);
        if (row?.valor === '1') return resolve();
        setImmediate(check);
      }
    );
    check();
  });
}

function montarXml({ nf, descricao, codigo, gtin = '', chaveFinal, unitCost = 10 }) {
  const chaveBase = '35261012345678000195550010000091001000091000';
  const chave = `${chaveBase.slice(0, 34)}${String(chaveFinal).padStart(10, '0')}`;
  const unitCostXml = Number(unitCost).toFixed(2);
  const totalXml = Number(unitCost * 12).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <NFe>
      <infNFe Id="NFe${chave}" versao="4.00">
        <ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${nf}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>12345678000195</CNPJ><xNome>Fornecedor Sprint 1G</xNome></emit>
        <det nItem="1"><prod>
          <cProd>${codigo}</cProd><cEAN>${gtin}</cEAN><xProd>${descricao}</xProd>
          <NCM>00000000</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>1</qCom><vUnCom>${totalXml}</vUnCom>
          <vProd>${totalXml}</vProd><cEANTrib>${gtin}</cEANTrib><uTrib>UN</uTrib><qTrib>12</qTrib><vUnTrib>${unitCostXml}</vUnTrib>
        </prod><imposto /></det>
        <total><ICMSTot><vProd>${totalXml}</vProd><vNF>${totalXml}</vNF></ICMSTot></total>
      </infNFe>
    </NFe>`;
}

function montarItemParaSave(itemCentral, { precoVendaManualLegado, precoVendaManualExplicito } = {}) {
  const item = {
    ...itemCentral,
    unidade_comercial: itemCentral.unidade_comercial || itemCentral.uCom || itemCentral.unidade,
    subtotal: Number(itemCentral.subtotal || itemCentral.valor_total || 120),
    preco_unitario: Number(itemCentral.preco_unitario || 120),
    origem_conversao: 'CENTRAL_NFE'
  };

  delete item.quantidade_fiscal;
  delete item.quantidade_nao_fiscal;
  delete item.quantidade_convertida;
  delete item.peso_total_compra;
  delete item.quantidade_por_embalagem;
  delete item.fator_conversao;
  delete item.atualizar_preco_venda;
  delete item.atualizar_preco_venda_editado_manual;

  if (precoVendaManualLegado != null) {
    item.atualizar_preco_venda = 1;
    item.atualizar_preco_venda_editado_manual = 1;
    item.preco_venda_sugerido = precoVendaManualLegado;
    item.margem_lucro = Number(((precoVendaManualLegado - 10) / 10 * 100).toFixed(2));
    item.margem_editada_manual = 1;
    item.margem_origem = 'manual';
  } else if (precoVendaManualExplicito != null) {
    item.precoVendaOriginal = 15;
    item.precoVendaAtual = precoVendaManualExplicito;
    item.precoVendaAlteradoManualmente = Number(precoVendaManualExplicito) !== 15;
    delete item.preco_venda_sugerido;
  } else {
    delete item.preco_venda_sugerido;
    delete item.margem_lucro;
    delete item.margem_editada_manual;
    delete item.margem_origem;
  }

  return item;
}

test('Central NF-e mantém preço de venda e ignora payload legado de autorização', async (t) => {
  await dbReady();
  const { CentralEntradasOrchestrator } = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
  const comprasRoutes = require('../../backend/rotas/compras');
  await waitForStockReconciliation();

  const central = new CentralEntradasOrchestrator({ db });
  const app = express();
  app.use(express.json());
  app.use('/api/compras', comprasRoutes);

  const fixtures = [
    { id: 9100, nf: 9100, code: 'SPRINT1G-A', name: 'Produto Existente Caso A CX12', gtin: '7891234509100' },
    { id: 9101, nf: 9101, code: 'SPRINT1G-B', name: 'Produto Existente Caso B CX12', gtin: '7891234509101' },
    {
      id: 9103,
      nf: 9103,
      code: 'SPRINT1G-C',
      name: 'Produto Existente Caso C CX12',
      gtin: '7891234509103',
      initialCost: 3.59,
      initialPrice: 4.85
    }
  ];
  for (const product of fixtures) {
    await runDb('DELETE FROM compras_itens WHERE produto_id = ?', [product.id]);
    await runDb('DELETE FROM compras WHERE observacao = ?', [`sprint1g-${product.id}`]);
    await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [product.id]);
    await runDb('DELETE FROM produtos WHERE id = ?', [product.id]);
    await runDb(
      `INSERT INTO produtos (
        id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
        preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
        saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
      ) VALUES (?, ?, 'UN', 'CAIXA', 12, ?, ?, 10, 0, 0, 10, 0, ?, 1, ?, 'Fornecedor Sprint 1G', 1)`,
      [product.id, product.name, product.initialCost ?? 8, product.initialPrice ?? 15, product.code, product.gtin]
    );
    await runDb(
      `INSERT INTO produto_embalagens (
        produto_id, tipo, quantidade, unidade, principal, compra, venda, estoque, ativa
      ) VALUES (?, 'CX', 12, 'UN', 1, 1, 1, 1, 1)`,
      [product.id]
    );
  }

  async function importarPelaCentral({ nf, codigo, descricao, gtin, produtoId, precoVendaManualLegado, precoVendaManualExplicito, unitCost, observacao }) {
    const xml = montarXml({ nf, codigo, descricao, gtin, chaveFinal: nf, unitCost });
    const upload = await central.uploadDocumentos([{
      originalname: `sprint1g-${nf}.xml`,
      mimetype: 'application/xml',
      buffer: Buffer.from(xml, 'utf8')
    }]);
    assert.equal(upload.importados, 1, JSON.stringify(upload));
    const uploadItem = upload.itens[0];
    const documentoId = Number(uploadItem.documentoId);
    assert.ok(documentoId > 0, 'upload da Central deve persistir o documento');

    let documento = await central.obterDocumento(documentoId);
    if (normalizarStatus(documento.status) === DocumentoFiscalStatus.EM_REVISAO) {
      const sessao = await central.obterOuCriarSessaoRevisao(documentoId, { usuarioId: null });
      assert.equal(Number(sessao.sessao.totalItens), 1);
      await central.salvarDecisaoRevisao(documentoId, 0, {
        decisao: produtoId ? 'ASSOCIAR' : 'CADASTRAR',
        produtoId: produtoId || null,
        item: produtoId ? { produto_id: produtoId } : {}
      });
    }

    const entrada = await central.finalizarEntrada(documentoId, { usuarioId: null });
    assert.equal(entrada.sucesso, true);
    assert.equal(entrada.proximaAcao, 'ABRIR_COMPRA');
    const dadosCompra = entrada.dadosCompra;
    assert.equal(Number(entrada.documentoId), documentoId);
    assert.equal(dadosCompra.itens.length, 1);

    const itemCentral = dadosCompra.itens[0];
    assert.equal(Number(itemCentral.quantidade ?? itemCentral.qCom), 1);
    assert.equal(Number(itemCentral.quantidade_tributavel ?? itemCentral.qTrib), 12);
    assert.equal(itemCentral.quantidade_fiscal, undefined, 'Bridge não deve fornecer quantidade fiscal pronta');
    assert.equal(itemCentral.quantidade_nao_fiscal, undefined, 'Bridge não deve fornecer quantidade não fiscal pronta');
    assert.equal(itemCentral.quantidade_convertida, undefined, 'Bridge não deve enviar estoque já convertido');

    const itens = [montarItemParaSave(itemCentral, { precoVendaManualLegado, precoVendaManualExplicito })];
    if (produtoId) itens[0].produto_id = produtoId;

    const body = {
      ...dadosCompra,
      data_compra: '2026-10-02',
      fornecedor: 'Fornecedor Sprint 1G',
      valor_produtos: Number((Number(unitCost ?? 10) * 12).toFixed(2)),
      valor_total_nota: Number((Number(unitCost ?? 10) * 12).toFixed(2)),
      total: Number((Number(unitCost ?? 10) * 12).toFixed(2)),
      tipo_entrada: 'REVENDA',
      origem_compra: 'CENTRAL_NFE',
      central_documento_id: documentoId,
      observacao,
      xml,
      itens
    };
    delete body.dadosCompra;

    const resposta = await request(app).post('/api/compras').send(body);
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    assert.ok(resposta.body.id, 'rota real de compras deve persistir o cabeçalho');

    documento = await central.obterDocumento(documentoId);
    assert.ok(documento, 'documento deve continuar persistido pela Central');

    return {
      compraId: Number(resposta.body.id),
      documentoId,
      chave: entrada.chave,
      xml,
      itemCentral,
      itemCompra: await getDb(
        `SELECT quantidade, quantidade_fiscal, quantidade_nao_fiscal,
                quantidade_embalagens, quantidade_por_embalagem,
                peso_total_compra, custo_unitario_final, unidade,
                preco_venda_sugerido, atualizar_preco_venda, margem_lucro
         FROM compras_itens WHERE compra_id = ?`,
        [resposta.body.id]
      ),
      produto: null
    };
  }

  async function consultarProduto(id) {
    return getDb(
      `SELECT id, nome, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal,
              preco_compra, preco_venda
       FROM produtos WHERE id = ?`,
      [id]
    );
  }

  async function executarCenarioExistente(product, options = {}) {
    const observacao = `sprint1g-${product.id}`;
    const antes = await consultarProduto(product.id);
    assert.equal(Number(antes.estoque_atual), 10);
    assert.equal(Number(antes.saldo_fiscal), 10);
    assert.equal(Number(antes.saldo_nao_fiscal), 0);
    assert.equal(Number(antes.preco_compra), product.initialCost ?? 8);
    assert.equal(Number(antes.preco_venda), product.initialPrice ?? 15);

    const resultado = await importarPelaCentral({
      nf: product.nf,
      codigo: product.code,
      descricao: product.name,
      gtin: product.gtin,
      produtoId: product.id,
      precoVendaManualLegado: options.precoVendaManualLegado,
      precoVendaManualExplicito: options.precoVendaManualExplicito,
      unitCost: options.unitCost,
      observacao
    });
    const produto = await consultarProduto(product.id);
    const item = resultado.itemCompra;

    assert.ok(item, 'item persistido deve ser lido do SQLite');
    assert.equal(Number(item.quantidade), 12);
    assert.equal(Number(item.quantidade_fiscal), 12);
    assert.equal(Number(item.quantidade_nao_fiscal), 0);
    assert.equal(Number(item.quantidade_embalagens), 1);
    assert.equal(Number(item.quantidade_por_embalagem), 12);
    assert.equal(Number(item.peso_total_compra), 12);
    const novoCusto = options.unitCost ?? 10;
    assert.equal(Number(item.custo_unitario_final), novoCusto);
    assert.equal(String(item.unidade).toUpperCase(), 'UN');
    assert.equal(Number(produto.estoque_atual), 22);
    assert.equal(Number(produto.saldo_fiscal), 22);
    assert.equal(Number(produto.saldo_nao_fiscal), 0);
    assert.equal(Number(produto.preco_compra), novoCusto);
    assert.equal(Number(resultado.itemCompra.quantidade), 12, 'quantidade efetiva nunca deve ser 144');
    const precoVendaEsperado = options.precoVendaManualExplicito ?? antes.preco_venda;
    assert.equal(Number(produto.preco_venda), Number(precoVendaEsperado));
    assert.equal(Number(item.atualizar_preco_venda), options.precoVendaManualExplicito == null ? 0 : 1);
    assert.equal(Number(item.preco_venda_sugerido), Number(precoVendaEsperado));
    assert.equal(Number(item.margem_lucro), Number((((precoVendaEsperado - novoCusto) / precoVendaEsperado) * 100).toFixed(2)));
    assert.notEqual(Number(item.quantidade), 144);
    return { ...resultado, produtoAntes: antes, produtoDepois: produto };
  }

  await t.test('produto existente: mantém preço 15 sem payload de preço', async () => {
    const resultado = await executarCenarioExistente(fixtures[0]);
    assert.equal(Number(resultado.produtoDepois.preco_venda), 15);
  });

  await t.test('produto existente: ignora flags e preço enviados por cliente legado', async () => {
    const resultado = await executarCenarioExistente(fixtures[1], { precoVendaManualLegado: 18 });
    assert.equal(Number(resultado.produtoAntes.preco_venda), 15);
    assert.equal(Number(resultado.produtoDepois.preco_venda), 15);
  });

  await t.test('produto existente: grava preço digitado explicitamente na Central', async () => {
    const resultado = await executarCenarioExistente(fixtures[2], {
      unitCost: 43.9,
      precoVendaManualExplicito: 55
    });
    assert.equal(Number(resultado.produtoAntes.preco_compra), 3.59);
    assert.equal(Number(resultado.produtoAntes.preco_venda), 4.85);
    assert.equal(Number(resultado.produtoDepois.preco_venda), 55);
    assert.equal(Number(resultado.itemCompra.margem_lucro), 20.18);
  });

  await t.test('produto novo: unidade, saldo fiscal e custo derivados do XML', async () => {
    const nf = 9102;
    const name = 'Tubo NEXUM QUANTIL 9405';
    const code = 'NEXUM-9405-NOVO';
    const xml = montarXml({ nf, descricao: name, codigo: code, chaveFinal: nf });
    const upload = await central.uploadDocumentos([{
      originalname: `sprint1g-${nf}.xml`,
      mimetype: 'application/xml',
      buffer: Buffer.from(xml, 'utf8')
    }]);
    assert.equal(upload.importados, 1, JSON.stringify(upload));
    const documentoId = Number(upload.itens[0].documentoId);
    const documento = await central.obterDocumento(documentoId);
    assert.equal(normalizarStatus(documento.status), DocumentoFiscalStatus.EM_REVISAO, 'produto desconhecido cai na revisão');
    const sessao = await central.obterOuCriarSessaoRevisao(documentoId, { usuarioId: null });
    assert.equal(Number(sessao.sessao.totalItens), 1);

    // Sprint 1: CENTRAL_NFE não cria produto em silêncio. O operador cadastra (unidade base UN,
    // sem apresentação CX) e a revisão associa o produto_id real à linha.
    const cadastro = await runDb(
      `INSERT INTO produtos (
        nome, unidade, preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
        saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, fornecedor, ativo
      ) VALUES (?, 'UN', 0, 0, 0, 0, 0, 0, 0, ?, 1, 'Fornecedor Sprint 1G', 1)`,
      [name, code]
    );
    const produtoId = Number(cadastro.lastID);
    await central.salvarDecisaoRevisao(documentoId, 0, {
      decisao: 'CADASTRAR',
      produtoId,
      item: { produto_id: produtoId }
    });

    // Sprint 2: 1 CX sem fator cadastrado → proposta qTrib 12 UN exige SIM, validado no backend.
    const conversoes = await central.avaliarConversoesRevisao(documentoId);
    assert.equal(conversoes.bloqueia_efetivacao, true, JSON.stringify(conversoes));
    assert.equal(Number(conversoes.pendencias[0].quantidade_resultante_proposta), 12);
    const aprendizadoAntes = await getDb('SELECT COUNT(*) AS total FROM muc_aprendizado WHERE produto_id = ?', [produtoId]);
    const sim = await central.salvarDecisaoConversaoRevisao(documentoId, 0, { decisao: 'SIM', documento_id: documentoId });
    assert.equal(sim.confirmada, true, JSON.stringify(sim));
    assert.equal(Number(sim.resultado_backend.quantidade_estoque), 12);

    const entrada = await central.finalizarEntrada(documentoId, { usuarioId: null });
    const itemCentral = entrada.dadosCompra.itens[0];
    assert.equal(Number(itemCentral.produto_id), produtoId);
    assert.equal(Number(itemCentral.quantidade ?? itemCentral.qCom), 1);
    assert.equal(Number(itemCentral.quantidade_tributavel ?? itemCentral.qTrib), 12);
    assert.equal(itemCentral.quantidade_fiscal, undefined);
    assert.equal(itemCentral.quantidade_nao_fiscal, undefined);

    const corpo = {
      ...entrada.dadosCompra,
      data_compra: '2026-10-02',
      fornecedor: 'Fornecedor Sprint 1G',
      valor_produtos: 120,
      valor_total_nota: 120,
      total: 120,
      tipo_entrada: 'REVENDA',
      origem_compra: 'CENTRAL_NFE',
      central_documento_id: documentoId,
      observacao: 'sprint1g-produto-novo',
      xml,
      itens: [montarItemParaSave(itemCentral)]
    };

    // Sem a decisão no payload, o backend bloqueia antes da transação: nada é gravado.
    const comprasAntes = await getDb('SELECT COUNT(*) AS total FROM compras');
    // A decisão viaja em confirmacoes_conversao e no próprio item; remove dos dois canais.
    const itemSemDecisao = { ...corpo.itens[0] };
    ['conversao', 'conversao_decisao', 'confirmacao_conversao', 'decisao_conversao', 'confirmacao']
      .forEach((campo) => delete itemSemDecisao[campo]);
    const semDecisao = await request(app).post('/api/compras').send({
      ...corpo,
      confirmacoes_conversao: [],
      itens: [itemSemDecisao]
    });
    assert.equal(semDecisao.status, 422, JSON.stringify(semDecisao.body));
    assert.equal(semDecisao.body.code, 'PENDENCIAS_CONVERSAO');
    assert.equal(Number((await getDb('SELECT COUNT(*) AS total FROM compras')).total), Number(comprasAntes.total));
    assert.equal(Number((await consultarProduto(produtoId)).estoque_atual), 0, 'estoque intocado sem decisão');

    const resposta = await request(app).post('/api/compras').send(corpo);
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    const aprendizadoDepois = await getDb('SELECT COUNT(*) AS total FROM muc_aprendizado WHERE produto_id = ?', [produtoId]);
    assert.equal(Number(aprendizadoDepois.total), Number(aprendizadoAntes.total), 'SIM não gera aprendizado permanente');
    const embalagensDepois = await getDb('SELECT COUNT(*) AS total FROM produto_embalagens WHERE produto_id = ? AND ativa = 1', [produtoId]);
    assert.equal(Number(embalagensDepois.total), 0, 'SIM não cria apresentação CX no cadastro');

    const produto = await getDb(
      `SELECT id, nome, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal,
              preco_compra, preco_venda
       FROM produtos WHERE nome = ?`,
      [name]
    );
    assert.ok(produto, 'produto cadastrado na revisão deve existir');
    assert.equal(Number(produto.id), produtoId, 'gravar a compra não pode criar outro produto');
    const item = await getDb(
      `SELECT quantidade, quantidade_fiscal, quantidade_nao_fiscal, peso_total_compra,
              custo_unitario_final, unidade, preco_venda_sugerido, atualizar_preco_venda,
              margem_lucro
       FROM compras_itens WHERE compra_id = ? AND produto_id = ?`,
      [resposta.body.id, produto.id]
    );
    assert.ok(item);
    assert.equal(String(produto.unidade).toUpperCase(), 'UN');
    assert.equal(Number(produto.estoque_atual), 12);
    assert.equal(Number(produto.saldo_fiscal), 12);
    assert.equal(Number(produto.saldo_nao_fiscal), 0);
    assert.equal(Number(produto.preco_compra), 10);
    assert.equal(Number(produto.preco_venda), 0);
    assert.equal(Number(item.quantidade), 12);
    assert.equal(Number(item.quantidade_fiscal), 12);
    assert.equal(Number(item.quantidade_nao_fiscal), 0);
    assert.equal(Number(item.peso_total_compra), 12);
    assert.equal(Number(item.custo_unitario_final), 10);
    assert.equal(String(item.unidade).toUpperCase(), 'UN');
    assert.equal(Number(item.preco_venda_sugerido), 0);
    assert.equal(Number(item.atualizar_preco_venda), 0);
    assert.equal(item.margem_lucro, null);
  });
});
