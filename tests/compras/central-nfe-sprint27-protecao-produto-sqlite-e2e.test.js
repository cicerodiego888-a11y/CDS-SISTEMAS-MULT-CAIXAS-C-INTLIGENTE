'use strict';

/**
 * Sprint 2.7 — produto decidido na Central não pode ser trocado na gravação da compra
 * (nem pela tela nem pela API) sem a correção explícita da Central.
 * Central real → tela de Compras real (VM) → rotas reais (compras + central-entradas) → SQLite temporário.
 */

const {
  DocumentoFiscalStatus,
  getDb,
  allDb,
  runDb,
  montarXml,
  criarCentral,
  criarPaginaCompras,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const request = require('supertest');

const GTIN = '7898043927013';
const PRODUTO_A = { id: 9701, nome: 'SORVETE SPRINT27 NAPOLITANO 2L (CADASTRO A)', precoVenda: 30, saldo: 10, gtin: GTIN };
const PRODUTO_B = { id: 9702, nome: 'SORVETE SPRINT27 NAPOLITANO 2L (CADASTRO B)', precoVenda: 31, saldo: 4, gtin: GTIN };
const PRODUTO_D = { id: 9703, nome: 'REFRIGERANTE SPRINT27 2L', precoVenda: 9, saldo: 7, gtin: '7898043927020' };
const PRODUTO_INATIVO = { id: 9704, nome: 'SORVETE SPRINT27 DESATIVADO', precoVenda: 5, saldo: 0, gtin: '7898043927037', ativo: 0 };
const USUARIO_ID = 1;

const caso = (nf) => ({
  nf,
  codigo: 'S27-NAPO-2L',
  gtin: GTIN,
  nome: 'SORV SPRINT27 NAPOLITANO 2L/950G - PCT C/4',
  uCom: 'PCT', qCom: 5, vUnCom: 80,
  uTrib: 'UN', qTrib: 20, vUnTrib: 20
});

const sha = (texto) => crypto.createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex');

async function parseDocumento(documentoId) {
  const row = await getDb('SELECT parse_json FROM central_entradas_documentos WHERE id = ?', [documentoId]);
  return JSON.parse(row.parse_json);
}

async function cadastrar(produto) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [produto.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [produto.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', 'UN', 1, 18, ?, ?, 0, 0, ?, 0, ?, 1, ?, 'Fornecedor Sprint 2.7', ?)`,
    [produto.id, produto.nome, produto.precoVenda, produto.saldo, produto.saldo, `INT-${produto.id}`, produto.gtin, produto.ativo ?? 1]
  );
}

/** Tudo que uma recusa não pode mudar. */
async function foto(documentoIds = []) {
  const ids = [PRODUTO_A.id, PRODUTO_B.id, PRODUTO_D.id, PRODUTO_INATIVO.id];
  const produtos = await allDb(
    `SELECT id, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_venda, ativo
     FROM produtos WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ids
  );
  const contar = async (sql) => Number((await getDb(sql)).n);
  const financeiro = await getDb('SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total FROM financeiro');
  const mapeamentos = await allDb('SELECT * FROM miip_associacoes ORDER BY id');
  const documentos = [];
  for (const id of documentoIds) {
    const doc = await getDb('SELECT status, compra_id, xml, parse_json FROM central_entradas_documentos WHERE id = ?', [id]);
    const revisao = await allDb(
      'SELECT sessao_id, item_index, produto_destino_id, decisao, status, dados_json FROM central_entradas_revisao_itens WHERE documento_id = ? ORDER BY id',
      [id]
    );
    documentos.push({ id, status: doc.status, compra_id: doc.compra_id, xml: sha(doc.xml), parse: sha(doc.parse_json), revisao });
  }
  return {
    produtos,
    produtosTotal: await contar('SELECT COUNT(*) AS n FROM produtos'),
    compras: await contar('SELECT COUNT(*) AS n FROM compras'),
    itens: await contar('SELECT COUNT(*) AS n FROM compras_itens'),
    financeiro: { n: Number(financeiro.n), total: Number(financeiro.total) },
    mapeamentos: sha(JSON.stringify(mapeamentos)),
    documentos
  };
}

async function upload(central, nf) {
  const xml = montarXml(caso(nf));
  const r = await central.uploadDocumentos([{
    originalname: `sprint27-${nf}.xml`, mimetype: 'application/xml', buffer: Buffer.from(xml, 'utf8')
  }]);
  assert.equal(r.importados, 1, JSON.stringify(r));
  const documentoId = Number(r.itens[0].documentoId);
  const documento = await central.obterDocumento(documentoId);
  assert.equal(documento.status, DocumentoFiscalStatus.EM_REVISAO, 'código repetido: operador decide');
  return { xml, documentoId };
}

/** Revisão do operador: escolhe o produto e confirma a conversão PCT → UN. */
async function decidir(central, documentoId, produtoId) {
  await central.obterOuCriarSessaoRevisao(documentoId, { usuarioId: USUARIO_ID });
  await central.salvarDecisaoRevisao(documentoId, 0, {
    decisao: 'ASSOCIAR', produtoId, item: { produto_id: produtoId }, usuarioId: USUARIO_ID
  });
  const conv = await central.salvarDecisaoConversaoRevisao(documentoId, 0, { decisao: 'SIM', documento_id: documentoId });
  assert.equal(conv.confirmada, true, JSON.stringify(conv));
}

async function esperar(condicao, descricao, pagina) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > 15000) {
      const reqs = pagina.requisicoes.map((r) => `${r.metodo} ${r.url} → ${r.resposta.status} ${JSON.stringify(r.resposta.body).slice(0, 200)}`);
      throw new Error(`Tempo esgotado: ${descricao} ${JSON.stringify({ reqs, notificacoes: pagina.notificacoes })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function abrirTela(app, documentoId, dadosCompra) {
  const pagina = criarPaginaCompras(app);
  pagina.sessao.set('central_abrir_compra', JSON.stringify({ documentoId, origem: 'CENTRAL_NFE', dadosCompra }));
  pagina.valores.set('input[name="politica_entrada_import"]:checked', 'REVENDA');
  pagina.context.loadCompras();
  await esperar(
    () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem) || n.tipo === 'danger'),
    'tela carregar a NF-e da Central', pagina
  );
  assert.deepEqual(pagina.notificacoes.filter((n) => n.tipo === 'danger'), []);
  return pagina;
}

const postsCompra = (pagina) => pagina.requisicoes.filter((r) => r.metodo === 'POST' && r.url === '/api/compras');
const postsCorrecao = (pagina) => pagina.requisicoes.filter((r) => /corrigir-produtos?$/.test(r.url));
const clonar = (valor) => JSON.parse(JSON.stringify(valor));

test('Sprint 2.7 — proteção do produto decidido na Central', async (t) => {
  const { app, central } = await criarCentral();
  app.use('/api/central-entradas', (req, _res, next) => {
    req.user = { id: USUARIO_ID };
    next();
  }, require('../../backend/rotas/central-entradas'));

  for (const p of [PRODUTO_A, PRODUTO_B, PRODUTO_D, PRODUTO_INATIVO]) await cadastrar(p);
  await runDb('DELETE FROM miip_associacoes WHERE codigo_fornecedor = ?', [caso(0).codigo]).catch(() => {});

  const doc1 = await upload(central, 9701);
  const doc2 = await upload(central, 9702);
  const fotoInicial = await foto([doc1.documentoId, doc2.documentoId]);

  await t.test('lista enviada pela tela ao finalizar não troca o produto escolhido na revisão; mesmo produto é aceito', async () => {
    await decidir(central, doc2.documentoId, PRODUTO_B.id);
    const linhaAtual = (await parseDocumento(doc2.documentoId)).itens[0];
    const entrada = await central.finalizarEntrada(doc2.documentoId, {
      usuarioId: USUARIO_ID,
      itens: [{ ...linhaAtual, produto_id: PRODUTO_A.id }]
    });
    assert.equal(Number(entrada.dadosCompra.itens[0].produto_id), PRODUTO_B.id);

    const tela = await lancarCompraPelaTela(app, { documentoId: doc2.documentoId, dadosCompra: entrada.dadosCompra });
    assert.equal(tela.gravacao.resposta.status, 200, JSON.stringify(tela.gravacao.resposta.body));
    const itens = await allDb('SELECT produto_id, quantidade FROM compras_itens WHERE compra_id = ?', [tela.gravacao.resposta.body.id]);
    assert.deepEqual(itens.map((i) => [Number(i.produto_id), Number(i.quantidade)]), [[PRODUTO_B.id, 20]]);
  });

  await decidir(central, doc1.documentoId, PRODUTO_B.id);
  let entrada = await central.finalizarEntrada(doc1.documentoId, { usuarioId: USUARIO_ID });
  assert.equal(Number(entrada.dadosCompra.itens[0].produto_id), PRODUTO_B.id);
  const chave = String((await central.obterDocumento(doc1.documentoId)).chave);

  let corpoTela;
  await t.test('linha alterada na tela: backend recusa antes de gravar e nada muda', async () => {
    const antes = await foto([doc1.documentoId]);
    const pagina = await abrirTela(app, doc1.documentoId, entrada.dadosCompra);
    pagina.confirmacoesModal.trocaProdutoCentralModal = '#trocaProdutoCentralCancelar|click';
    pagina.context.alterarProdutoItemCompra(0, PRODUTO_A.id);
    pagina.context.saveCompra();
    await esperar(() => pagina.notificacoes.some((n) => /Compra não gravada/.test(n.mensagem)), 'aviso de compra não gravada', pagina);

    const [post] = postsCompra(pagina);
    corpoTela = clonar(post.corpo);
    assert.equal(post.resposta.status, 422);
    assert.equal(post.resposta.body.code, 'PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL');
    assert.equal(Number(post.resposta.body.linhas[0].produto_id_decidido), PRODUTO_B.id);
    assert.equal(Number(post.resposta.body.linhas[0].produto_id_enviado), PRODUTO_A.id);
    assert.equal(postsCorrecao(pagina).length, 0, 'sem confirmação do operador, nada é corrigido');
    assert.deepEqual(await foto([doc1.documentoId]), antes);
  });

  await t.test('outro produto_id pela API: recusado antes de qualquer gravação', async () => {
    const antes = await foto([doc1.documentoId]);
    for (const produtoId of [PRODUTO_D.id, PRODUTO_INATIVO.id, 999999]) {
      const corpo = clonar(corpoTela);
      corpo.itens[0].produto_id = produtoId;
      const r = await request(app).post('/api/compras').send(corpo);
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.equal(r.body.code, 'PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL');
    }
    assert.deepEqual(await foto([doc1.documentoId]), antes);
  });

  await t.test('linha sem identidade, documento inexistente ou origem disfarçada: recusado', async () => {
    const antes = await foto([doc1.documentoId]);
    const casos = [
      ['LINHA_CENTRAL_NAO_IDENTIFICADA', 'LINHA_CENTRAL_NAO_IDENTIFICADA', (c) => {
        ['central_item_indice', 'centralItemIndice', 'nItem', 'nitem', 'linha_xml', 'item_key', 'itemKey'].forEach((k) => delete c.itens[0][k]);
      }],
      ['LINHA_CENTRAL_NAO_IDENTIFICADA', 'LINHA_CENTRAL_INEXISTENTE', (c) => { c.itens[0].central_item_indice = 7; }],
      ['LINHA_CENTRAL_NAO_IDENTIFICADA', null, (c) => { delete c.central_documento_id; }],
      ['DOCUMENTO_CENTRAL_NAO_ENCONTRADO', null, (c) => { c.central_documento_id = 999999; }],
      ['ORIGEM_CENTRAL_OBRIGATORIA', null, (c) => { c.origem_compra = 'MANUAL'; delete c.central_documento_id; }],
      ['ORIGEM_CENTRAL_OBRIGATORIA', null, (c) => { c.origem_compra = 'MANUAL'; }]
    ];
    for (const [codigo, codigoLinha, alterar] of casos) {
      const corpo = clonar(corpoTela);
      corpo.itens[0].produto_id = PRODUTO_B.id;
      alterar(corpo);
      const r = await request(app).post('/api/compras').send(corpo);
      assert.equal(r.status, 422, `${codigo}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, codigo);
      if (codigoLinha) assert.equal(r.body.linhas?.[0]?.codigo, codigoLinha, JSON.stringify(r.body));
    }
    assert.deepEqual(await foto([doc1.documentoId]), antes);
  });

  await t.test('correção explícita: validações recusam sem alterar nada', async () => {
    const antes = await foto([doc1.documentoId]);
    const rota = `/api/central-entradas/${doc1.documentoId}/itens/0/corrigir-produto`;
    const base = { produto_id: PRODUTO_A.id, produto_anterior_id: PRODUTO_B.id, motivo: 'Cadastro B é duplicado do A' };
    const casos = [
      [422, 'MOTIVO_OBRIGATORIO', { motivo: 'erro' }],
      [409, 'DECISAO_ALTERADA', { produto_anterior_id: PRODUTO_A.id }],
      [422, 'PRODUTO_INATIVO', { produto_id: PRODUTO_INATIVO.id }],
      [422, 'PRODUTO_INEXISTENTE', { produto_id: 999999 }],
      [422, 'DOCUMENTO_CENTRAL_DIVERGENTE', { chave_acesso: '1'.repeat(44) }]
    ];
    for (const [status, codigo, extra] of casos) {
      const r = await request(app).post(rota).send({ ...base, ...extra });
      assert.equal(r.status, status, `${codigo}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, codigo);
    }
    const linhaInexistente = await request(app)
      .post(`/api/central-entradas/${doc1.documentoId}/itens/5/corrigir-produto`).send(base);
    assert.equal(linhaInexistente.body.code, 'LINHA_CENTRAL_INEXISTENTE');
    await assert.rejects(
      () => central.corrigirProdutoLinha(doc1.documentoId, 0, { ...base, usuarioId: null }),
      (err) => err.statusCode === 401 && err.code === 'USUARIO_OBRIGATORIO'
    );
    assert.deepEqual(await foto([doc1.documentoId]), antes);
  });

  await t.test('correção autorizada pela tela: grava na Central e volta a exigir a confirmação da conversão', async () => {
    const compras = (await foto()).compras;
    const pagina = await abrirTela(app, doc1.documentoId, entrada.dadosCompra);
    pagina.valores.set('#trocaProdutoCentralMotivo', 'Cadastro B é duplicado; o certo é o A');
    pagina.context.alterarProdutoItemCompra(0, PRODUTO_A.id);
    pagina.context.saveCompra();
    await esperar(() => postsCompra(pagina).length >= 2, 'nova tentativa de gravação após a correção', pagina);

    const [correcao] = postsCorrecao(pagina);
    assert.equal(correcao.resposta.status, 200, JSON.stringify(correcao.resposta.body));
    assert.equal(correcao.resposta.body.linhas[0].requer_nova_confirmacao_conversao, true);
    const segunda = postsCompra(pagina)[1];
    assert.equal(segunda.resposta.status, 422);
    assert.equal(segunda.resposta.body.code, 'PENDENCIAS_CONVERSAO', 'conversão confirmada para o produto anterior não vale mais');
    assert.equal((await foto()).compras, compras, 'nenhuma compra gravada');

    const linha = (await parseDocumento(doc1.documentoId)).itens[0];
    assert.equal(Number(linha.produto_id), PRODUTO_A.id);
    assert.equal(linha.conversao, undefined);
    assert.equal(linha.correcoes_produto.at(-1).produto_anterior_id, PRODUTO_B.id);
    const decisao = await getDb(
      'SELECT produto_destino_id, usuario_id FROM central_entradas_revisao_itens WHERE documento_id = ? AND item_index = 0',
      [doc1.documentoId]
    );
    assert.equal(Number(decisao.produto_destino_id), PRODUTO_A.id);
    assert.equal(Number(decisao.usuario_id), USUARIO_ID);
    assert.equal((await foto()).mapeamentos, fotoInicial.mapeamentos, 'mapeamentos fornecedor + código intactos');
  });

  await t.test('após a correção, o produto antigo é que passa a ser recusado', async () => {
    const corpo = clonar(corpoTela);
    corpo.itens[0].produto_id = PRODUTO_B.id;
    const antes = await foto([doc1.documentoId]);
    const r = await request(app).post('/api/compras').send(corpo);
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL');
    assert.deepEqual(await foto([doc1.documentoId]), antes);
  });

  let gravacao;
  await t.test('nova confirmação da conversão + gravação: produto corrigido, quantidade convertida uma vez', async () => {
    const conv = await central.salvarDecisaoConversaoRevisao(doc1.documentoId, 0, { decisao: 'SIM', documento_id: doc1.documentoId });
    assert.equal(conv.confirmada, true, JSON.stringify(conv));
    entrada = await central.finalizarEntrada(doc1.documentoId, { usuarioId: USUARIO_ID });
    assert.equal(Number(entrada.dadosCompra.itens[0].produto_id), PRODUTO_A.id);

    const antes = await foto();
    const tela = await lancarCompraPelaTela(app, { documentoId: doc1.documentoId, dadosCompra: entrada.dadosCompra });
    gravacao = tela.gravacao;
    assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
    const itens = await allDb('SELECT produto_id, quantidade FROM compras_itens WHERE compra_id = ?', [gravacao.resposta.body.id]);
    assert.deepEqual(itens.map((i) => [Number(i.produto_id), Number(i.quantidade)]), [[PRODUTO_A.id, 20]]);

    const depois = await foto([doc1.documentoId]);
    const produto = (f, id) => f.produtos.find((p) => Number(p.id) === id);
    assert.equal(Number(produto(depois, PRODUTO_A.id).saldo_fiscal), Number(produto(antes, PRODUTO_A.id).saldo_fiscal) + 20);
    assert.deepEqual(produto(depois, PRODUTO_B.id), produto(antes, PRODUTO_B.id), 'produto antigo sem movimento');
    assert.equal(Number(produto(depois, PRODUTO_A.id).preco_venda), PRODUTO_A.precoVenda, 'preço de venda intacto');
    assert.equal(depois.compras, antes.compras + 1);
    assert.equal(depois.documentos[0].xml, sha(doc1.xml), 'XML original preservado');
    assert.equal(chave.length, 44);
  });

  await t.test('repetição não duplica; correção depois da compra é recusada', async () => {
    const antes = await foto([doc1.documentoId]);
    const repetida = await request(app).post('/api/compras').send(gravacao.corpo);
    assert.ok(repetida.status >= 400, JSON.stringify(repetida.body));
    await assert.rejects(
      () => central.finalizarEntrada(doc1.documentoId, { usuarioId: USUARIO_ID }),
      (err) => err.statusCode === 409 && err.codigo === 'DOCUMENTO_JA_IMPORTADO'
    );
    const correcao = await request(app)
      .post(`/api/central-entradas/${doc1.documentoId}/itens/0/corrigir-produto`)
      .send({ produto_id: PRODUTO_B.id, produto_anterior_id: PRODUTO_A.id, motivo: 'Tentativa depois da compra' });
    assert.equal(correcao.status, 409);
    assert.equal(correcao.body.code, 'DOCUMENTO_JA_IMPORTADO');
    assert.deepEqual(await foto([doc1.documentoId]), antes);
  });
});
