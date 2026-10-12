'use strict';

/**
 * Sprint 2.6 — grupo 6: entrada completa com código de barras repetido, escolha do operador,
 * conversão (PCT → UN), efetivação e tentativa repetida.
 * Central real → identificação MIIP real → tela de Compras real (VM) → rotas reais → SQLite temporário.
 */

const {
  DocumentoFiscalStatus,
  getDb,
  allDb,
  runDb,
  montarXml,
  criarCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const request = require('supertest');
const { getMiipService } = require('../../backend/motores/miip/getMiipService');

const GTIN_REPETIDO = '7898043926016';
const CNPJ_FORNECEDOR = '11222333000181';
const PRODUTO_A = { id: 9601, nome: 'SORVETE SPRINT26 NAPOLITANO 2L (CADASTRO A)', precoVenda: 30, saldoFiscal: 10 };
const PRODUTO_B = { id: 9602, nome: 'SORVETE SPRINT26 NAPOLITANO 2L (CADASTRO B)', precoVenda: 31, saldoFiscal: 4 };

const caso = (nf) => ({
  nf,
  codigo: 'S26-NAPO-2L',
  gtin: GTIN_REPETIDO,
  nome: 'SORV SPRINT26 NAPOLITANO 2L/950G - PCT C/4',
  uCom: 'PCT', qCom: 5, vUnCom: 80,
  uTrib: 'UN', qTrib: 20, vUnTrib: 20
});

async function cadastrar(produto) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [produto.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [produto.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', 'UN', 1, 18, ?, ?, 0, 0, ?, 0, ?, 1, ?, 'Fornecedor Sprint 2.6', 1)`,
    [produto.id, produto.nome, produto.precoVenda, produto.saldoFiscal, produto.saldoFiscal, `INT-${produto.id}`, GTIN_REPETIDO]
  );
}

async function foto() {
  const produtos = await allDb(
    'SELECT id, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_venda FROM produtos WHERE id IN (?, ?) ORDER BY id',
    [PRODUTO_A.id, PRODUTO_B.id]
  );
  const compras = await getDb('SELECT COUNT(*) AS n FROM compras');
  const itens = await getDb('SELECT COUNT(*) AS n FROM compras_itens');
  const financeiro = await getDb('SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total FROM financeiro');
  const produtosTotal = await getDb('SELECT COUNT(*) AS n FROM produtos');
  return {
    produtos,
    compras: Number(compras.n),
    itens: Number(itens.n),
    financeiro: { n: Number(financeiro.n), total: Number(financeiro.total) },
    produtosTotal: Number(produtosTotal.n)
  };
}

async function upload(central, nf) {
  const xml = montarXml(caso(nf));
  const r = await central.uploadDocumentos([{
    originalname: `sprint26-${nf}.xml`, mimetype: 'application/xml', buffer: Buffer.from(xml, 'utf8')
  }]);
  assert.equal(r.importados, 1, JSON.stringify(r));
  const documentoId = Number(r.itens[0].documentoId);
  const documento = await central.obterDocumento(documentoId);
  const linha = await getDb('SELECT miip_resumo_json, parse_json FROM central_entradas_documentos WHERE id = ?', [documentoId]);
  const miip = JSON.parse(linha?.miip_resumo_json || '{}')?.resultados?.[0] || null;
  const item = JSON.parse(linha?.parse_json || '{}')?.itens?.[0] || null;
  return { xml, documentoId, documento, item, miip };
}

async function xmlGuardado(documentoId) {
  const linha = await getDb('SELECT xml FROM central_entradas_documentos WHERE id = ?', [documentoId]);
  return linha?.xml ?? null;
}

const sha = (texto) => crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');

test('Sprint 2.6 — grupo 6: código repetido → escolha → conversão → efetivação → tentativa repetida', async (t) => {
  const { app, central } = await criarCentral();
  await cadastrar(PRODUTO_A);
  await cadastrar(PRODUTO_B);
  await runDb('DELETE FROM miip_associacoes WHERE codigo_fornecedor = ?', [caso(0).codigo]).catch(() => {});
  const inicial = await foto();

  const rec = await upload(central, 9601);

  await t.test('código de barras repetido não escolhe o primeiro: documento vai para revisão', async () => {
    assert.equal(rec.documento.status, DocumentoFiscalStatus.EM_REVISAO);
    assert.ok(!rec.item.produto_id, 'nenhum produto pode ser vinculado sozinho');
    const miip = rec.miip;
    assert.ok(miip, 'resultado da identificação guardado no documento');
    assert.equal(miip.associadoAutomaticamente, false);
    assert.equal(miip.precisaConfirmacao, true);
    const ids = (miip.candidatos || []).map((c) => Number(c.produtoId)).sort();
    assert.deepEqual(ids, [PRODUTO_A.id, PRODUTO_B.id], 'os dois cadastros aparecem para escolha');
  });

  await t.test('item pendente bloqueia a efetivação (backend)', async () => {
    await central.obterOuCriarSessaoRevisao(rec.documentoId, { usuarioId: null });
    await assert.rejects(
      () => central.finalizarEntrada(rec.documentoId, { usuarioId: null }),
      /Revisão incompleta/
    );
    const doc = await central.obterDocumento(rec.documentoId);
    assert.equal(doc.status, DocumentoFiscalStatus.EM_REVISAO, 'documento continua em revisão');
    assert.deepEqual(await foto(), inicial, 'nada gravado em compras, estoque ou financeiro');
  });

  let entrada;
  await t.test('operador escolhe o cadastro B e confirma a conversão; a entrada continua sem recomeçar', async () => {
    await central.salvarDecisaoRevisao(rec.documentoId, 0, {
      decisao: 'ASSOCIAR', produtoId: PRODUTO_B.id, item: { produto_id: PRODUTO_B.id }
    });
    const conv = await central.salvarDecisaoConversaoRevisao(rec.documentoId, 0, {
      decisao: 'SIM', documento_id: rec.documentoId
    });
    assert.equal(conv.confirmada, true, JSON.stringify(conv));
    assert.equal(Number(conv.resultado_backend?.quantidade_estoque), 20, '5 PCT × 4 = 20 UN');

    const painel = await central.avaliarConversoesRevisao(rec.documentoId);
    assert.equal(painel.bloqueia_efetivacao, false);
    assert.equal(painel.linhas[0].estado_decisao, 'SIM', 'a tela precisa ver o SIM gravado, não "Pendente"');

    entrada = await central.finalizarEntrada(rec.documentoId, { usuarioId: null });
    assert.equal(entrada.sucesso, true);
    assert.equal(Number(entrada.documentoId), rec.documentoId, 'mesmo documento retomado');
    assert.equal(Number(entrada.dadosCompra.itens[0].produto_id), PRODUTO_B.id);
  });

  let gravacao;
  await t.test('efetivação pela tela de Compras: produto, unidade, quantidade convertida uma vez, preço de venda intacto', async () => {
    const recebimento = { documentoId: rec.documentoId, dadosCompra: entrada.dadosCompra };
    const tela = await lancarCompraPelaTela(app, recebimento);
    gravacao = tela.gravacao;
    assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
    assert.equal(Number(tela.itensTela[0].quantidade_convertida), 20);

    const compraId = Number(gravacao.resposta.body.id);
    const itens = await allDb('SELECT produto_id, quantidade, unidade, custo_unitario_final FROM compras_itens WHERE compra_id = ?', [compraId]);
    assert.equal(itens.length, 1);
    assert.equal(Number(itens[0].produto_id), PRODUTO_B.id);
    assert.equal(Number(itens[0].quantidade), 20);
    assert.equal(String(itens[0].unidade).toUpperCase(), 'UN');
    assert.equal(Number(itens[0].custo_unitario_final), 20);

    const depois = await foto();
    const [a, b] = depois.produtos;
    assert.deepEqual(a, inicial.produtos[0], 'cadastro A não é tocado');
    assert.equal(Number(b.saldo_fiscal), PRODUTO_B.saldoFiscal + 20, 'estoque do B soma 20 uma única vez');
    assert.equal(Number(b.estoque_atual), PRODUTO_B.saldoFiscal + 20);
    assert.equal(String(b.unidade).toUpperCase(), 'UN', 'unidade principal não muda');
    assert.equal(Number(b.preco_venda), PRODUTO_B.precoVenda, 'preço de venda não muda sozinho');
    assert.equal(depois.compras, inicial.compras + 1);
    assert.equal(depois.itens, inicial.itens + 1);
    assert.equal(depois.produtosTotal, inicial.produtosTotal, 'nenhum cadastro criado');
    t.diagnostic(`financeiro: ${inicial.financeiro.n} → ${depois.financeiro.n} lançamentos; total ${inicial.financeiro.total} → ${depois.financeiro.total}`);

    const guardado = await xmlGuardado(rec.documentoId);
    t.diagnostic(`XML: enviado ${rec.xml.length} chars, guardado ${guardado?.length ?? 'null'} chars`);
    assert.equal(sha(guardado), sha(rec.xml), 'XML original preservado byte a byte');
    const doc = await central.obterDocumento(rec.documentoId);
    assert.equal(Number(doc.compraId || doc.compra_id), compraId, 'documento vinculado à compra');
  });

  await t.test('tentativa repetida não duplica compra, itens, estoque nem financeiro', async () => {
    const antes = await foto();
    const repetida = await request(app).post('/api/compras').send(gravacao.corpo).timeout({ response: 15000 });
    t.diagnostic(`reenvio do mesmo POST /api/compras → ${repetida.status} ${JSON.stringify(repetida.body).slice(0, 200)}`);
    assert.ok(repetida.status >= 400 || repetida.body?.idempotente === true, 'reenvio precisa ser recusado ou idempotente');
    assert.deepEqual(await foto(), antes, 'nenhuma escrita na repetição');

    await assert.rejects(
      () => central.finalizarEntrada(rec.documentoId, { usuarioId: null }),
      (err) => err.statusCode === 409 && err.codigo === 'DOCUMENTO_JA_IMPORTADO'
    );
    assert.deepEqual(await foto(), antes);
    await runDb('BEGIN IMMEDIATE');
    await runDb('ROLLBACK');
  });

  await t.test('com a escolha confirmada pelo operador, a próxima nota do mesmo fornecedor + código entra direto', async () => {
    const fb = await getMiipService().registrarFeedback({
      confirmado: true, produtoId: PRODUTO_B.id, fornecedorCnpj: CNPJ_FORNECEDOR, codigoFornecedor: caso(0).codigo,
      nomeItem: caso(0).nome, codigoBarras: GTIN_REPETIDO, unidade: 'PCT', origem: 'Confirmacao Manual'
    });
    assert.equal(fb.sucesso, true, JSON.stringify(fb));

    const segunda = await upload(central, 9602);
    assert.equal(Number(segunda.item.produto_id), PRODUTO_B.id);
    assert.equal(segunda.miip.associadoAutomaticamente, true);
    assert.equal(segunda.documento.status, DocumentoFiscalStatus.PRONTA_IMPORTACAO, 'sem pergunta, pronta para importar');
  });
});
