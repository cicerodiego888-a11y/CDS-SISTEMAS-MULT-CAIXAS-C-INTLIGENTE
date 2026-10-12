'use strict';

/**
 * Sprint 2.8 — correção de produto atômica (tudo ou nada) e confirmação de conversão
 * amarrada ao contexto exato em que foi aprovada.
 * Central real → tela de Compras real (VM) → rotas reais (compras + central-entradas) → SQLite temporário.
 * Falhas simuladas com gatilhos do SQLite (RAISE(ABORT)) no banco temporário, em cada tabela gravada pela correção.
 * Gatilhos comuns (não TEMP): a correção grava numa conexão própria e gatilho TEMP só vale na conexão que o criou.
 */

const {
  DocumentoFiscalStatus,
  getDb,
  allDb,
  runDb,
  criarCentral,
  criarPaginaCompras,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const request = require('supertest');

const GTIN_NAPO = '7898043928010';
const GTIN_CHOC = '7898043928027';
const PRODUTO_A = { id: 9801, nome: 'SORVETE SPRINT28 NAPOLITANO 2L (CADASTRO A)', precoVenda: 30, saldo: 10, gtin: GTIN_NAPO };
const PRODUTO_B = { id: 9802, nome: 'SORVETE SPRINT28 NAPOLITANO 2L (CADASTRO B)', precoVenda: 31, saldo: 4, gtin: GTIN_NAPO };
const PRODUTO_C = { id: 9803, nome: 'SORVETE SPRINT28 CHOCOLATE 1L', precoVenda: 22, saldo: 6, gtin: GTIN_CHOC };
const PRODUTO_INATIVO = { id: 9804, nome: 'SORVETE SPRINT28 DESATIVADO', precoVenda: 5, saldo: 0, gtin: '7898043928034', ativo: 0 };
const USUARIO_ID = 1;
const CNPJ_TESTE = '11222333000181';

const LINHA_NAPO = {
  codigo: 'S28-NAPO-2L', gtin: GTIN_NAPO, nome: 'SORV SPRINT28 NAPOLITANO 2L - PCT C/4',
  uCom: 'PCT', qCom: 5, vUnCom: 80, uTrib: 'UN', qTrib: 20, vUnTrib: 20
};
const LINHA_CHOC = {
  codigo: 'S28-CHOC-1L', gtin: GTIN_CHOC, nome: 'SORV SPRINT28 CHOCOLATE 1L - PCT C/4',
  uCom: 'PCT', qCom: 3, vUnCom: 60, uTrib: 'UN', qTrib: 12, vUnTrib: 15
};

const sha = (texto) => crypto.createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex');
const clonar = (valor) => JSON.parse(JSON.stringify(valor));

function digitoChave(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function montarXmlNota(nf, linhas) {
  const chave43 = `3526101122233300018155001${String(nf).padStart(9, '0')}1${String(nf).padStart(8, '0')}`;
  const chave = `${chave43}${digitoChave(chave43)}`;
  const total = linhas.reduce((s, l) => s + l.qCom * l.vUnCom, 0).toFixed(2);
  const dets = linhas.map((l, i) => `
        <det nItem="${i + 1}"><prod>
          <cProd>${l.codigo}</cProd><cEAN>${l.gtin}</cEAN><xProd>${l.nome}</xProd>
          <NCM>00000000</NCM><CFOP>5102</CFOP>
          <uCom>${l.uCom}</uCom><qCom>${l.qCom}</qCom><vUnCom>${l.vUnCom.toFixed(2)}</vUnCom>
          <vProd>${(l.qCom * l.vUnCom).toFixed(2)}</vProd><cEANTrib>${l.gtin}</cEANTrib>
          <uTrib>${l.uTrib}</uTrib><qTrib>${l.qTrib}</qTrib><vUnTrib>${l.vUnTrib.toFixed(2)}</vUnTrib>
        </prod><imposto /></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <NFe>
      <infNFe Id="NFe${chave}" versao="4.00">
        <ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${nf}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>${CNPJ_TESTE}</CNPJ><xNome>Fornecedor Sprint 2.8</xNome></emit>${dets}
        <total><ICMSTot><vProd>${total}</vProd><vNF>${total}</vNF></ICMSTot></total>
      </infNFe>
    </NFe>`;
}

async function cadastrar(produto) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [produto.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [produto.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', 'UN', 1, 18, ?, ?, 0, 0, ?, 0, ?, 1, ?, 'Fornecedor Sprint 2.8', ?)`,
    [produto.id, produto.nome, produto.precoVenda, produto.saldo, produto.saldo, `INT-${produto.id}`, produto.gtin, produto.ativo ?? 1]
  );
}

async function parseDocumento(documentoId) {
  const row = await getDb('SELECT parse_json FROM central_entradas_documentos WHERE id = ?', [documentoId]);
  return JSON.parse(row.parse_json);
}

/** Tudo que uma recusa ou uma correção desfeita não pode mudar. */
async function foto(documentoIds = []) {
  const ids = [PRODUTO_A.id, PRODUTO_B.id, PRODUTO_C.id, PRODUTO_INATIVO.id];
  const produtos = await allDb(
    `SELECT id, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_venda, ativo
     FROM produtos WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ids
  );
  const contar = async (sql) => Number((await getDb(sql)).n);
  const financeiro = await getDb('SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total FROM financeiro');
  const documentos = [];
  for (const id of documentoIds) {
    const doc = await getDb('SELECT status, compra_id, xml, parse_json FROM central_entradas_documentos WHERE id = ?', [id]);
    documentos.push({
      id,
      status: doc.status,
      compra_id: doc.compra_id,
      xml: sha(doc.xml),
      parse: sha(doc.parse_json),
      revisao: await allDb(
        'SELECT sessao_id, item_index, produto_destino_id, decisao, status, dados_json, usuario_id FROM central_entradas_revisao_itens WHERE documento_id = ? ORDER BY id',
        [id]
      ),
      historico: await allDb('SELECT id, status_anterior, status_novo, detalhe FROM central_entradas_historico WHERE documento_id = ? ORDER BY id', [id])
    });
  }
  return {
    produtos,
    produtosTotal: await contar('SELECT COUNT(*) AS n FROM produtos'),
    compras: await contar('SELECT COUNT(*) AS n FROM compras'),
    itens: await contar('SELECT COUNT(*) AS n FROM compras_itens'),
    financeiro: { n: Number(financeiro.n), total: Number(financeiro.total) },
    mapeamentos: sha(JSON.stringify(await allDb('SELECT * FROM miip_associacoes ORDER BY id'))),
    documentos
  };
}

async function upload(central, nf, linhas) {
  const xml = montarXmlNota(nf, linhas);
  const r = await central.uploadDocumentos([{
    originalname: `sprint28-${nf}.xml`, mimetype: 'application/xml', buffer: Buffer.from(xml, 'utf8')
  }]);
  assert.equal(r.importados, 1, JSON.stringify(r));
  const documentoId = Number(r.itens[0].documentoId);
  assert.equal((await central.obterDocumento(documentoId)).status, DocumentoFiscalStatus.EM_REVISAO);
  return { xml, documentoId };
}

/** Revisão do operador: produto de cada linha + SIM da conversão PCT → UN, depois finalizar. */
async function revisarEFinalizar(central, documentoId, produtosPorLinha) {
  await central.obterOuCriarSessaoRevisao(documentoId, { usuarioId: USUARIO_ID });
  for (const [indice, produtoId] of produtosPorLinha.entries()) {
    await central.salvarDecisaoRevisao(documentoId, indice, {
      decisao: 'ASSOCIAR', produtoId, item: { produto_id: produtoId }, usuarioId: USUARIO_ID
    });
    const conv = await central.salvarDecisaoConversaoRevisao(documentoId, indice, { decisao: 'SIM', documento_id: documentoId });
    assert.equal(conv.confirmada, true, JSON.stringify(conv));
    assert.match(conv.conversao.selo_conversao, /^v1\.[0-9a-f]{64}$/, 'SIM da Central gravado com selo');
  }
  return central.finalizarEntrada(documentoId, { usuarioId: USUARIO_ID });
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

test('Sprint 2.8 — correção atômica e confirmação de conversão no contexto exato', async (t) => {
  const { app, central } = await criarCentral();
  app.use('/api/central-entradas', (req, _res, next) => {
    req.user = { id: USUARIO_ID };
    next();
  }, require('../../backend/rotas/central-entradas'));

  for (const p of [PRODUTO_A, PRODUTO_B, PRODUTO_C, PRODUTO_INATIVO]) await cadastrar(p);
  await runDb('DELETE FROM miip_associacoes WHERE codigo_fornecedor IN (?, ?)', [LINHA_NAPO.codigo, LINHA_CHOC.codigo]).catch(() => {});

  // Nota X: 2 linhas (napolitano → B, chocolate → C). Nota Y: 1 linha (napolitano → B).
  const docX = await upload(central, 9801, [LINHA_NAPO, LINHA_CHOC]);
  const docY = await upload(central, 9802, [LINHA_NAPO]);
  let entradaX = await revisarEFinalizar(central, docX.documentoId, [PRODUTO_B.id, PRODUTO_C.id]);
  const entradaY = await revisarEFinalizar(central, docY.documentoId, [PRODUTO_B.id]);
  const confX = clonar(entradaX.dadosCompra.confirmacoes_conversao);
  const confY = clonar(entradaY.dadosCompra.confirmacoes_conversao);
  assert.equal(confX.length, 2);
  confX.concat(confY).forEach((c) => assert.match(String(c.selo_conversao), /^v1\.[0-9a-f]{64}$/, 'Central envia o selo para Compras'));
  assert.notEqual(confX[0].selo_conversao, confY[0].selo_conversao, 'mesma linha e produto em outra nota: outro selo');
  assert.notEqual(confX[0].selo_conversao, confX[1].selo_conversao, 'outra linha: outro selo');

  const rotaLote = `/api/central-entradas/${docX.documentoId}/corrigir-produtos`;
  const motivo = 'Cadastro B é duplicado; o certo é o A';
  const trocaBparaA = { linhas: [{ indice: 0, produto_id: PRODUTO_A.id, produto_anterior_id: PRODUTO_B.id }], motivo };

  await t.test('confirmação válida para a linha e a conversão corretas: grava uma vez; repetição não duplica', async () => {
    const tela = await lancarCompraPelaTela(app, { documentoId: docY.documentoId, dadosCompra: entradaY.dadosCompra });
    assert.equal(tela.gravacao.resposta.status, 200, JSON.stringify(tela.gravacao.resposta.body));
    assert.equal(tela.gravacao.corpo.confirmacoes_conversao[0].selo_conversao, confY[0].selo_conversao);
    const itens = await allDb('SELECT produto_id, quantidade FROM compras_itens WHERE compra_id = ?', [tela.gravacao.resposta.body.id]);
    assert.deepEqual(itens.map((i) => [Number(i.produto_id), Number(i.quantidade)]), [[PRODUTO_B.id, 20]]);

    const antes = await foto([docY.documentoId]);
    const repetida = await request(app).post('/api/compras').send(tela.gravacao.corpo);
    assert.ok(repetida.status >= 400, JSON.stringify(repetida.body));
    assert.deepEqual(await foto([docY.documentoId]), antes);
  });

  // Corpo real da tela para a nota X (recusado antes de gravar porque a tela trocou o produto).
  let corpoX;
  await t.test('corpo da tela da nota X carrega o selo de cada linha', async () => {
    const antes = await foto([docX.documentoId]);
    const pagina = await abrirTela(app, docX.documentoId, entradaX.dadosCompra);
    pagina.confirmacoesModal.trocaProdutoCentralModal = '#trocaProdutoCentralCancelar|click';
    pagina.context.alterarProdutoItemCompra(0, PRODUTO_A.id);
    pagina.context.saveCompra();
    await esperar(() => pagina.notificacoes.some((n) => /Compra não gravada/.test(n.mensagem)), 'aviso de compra não gravada', pagina);
    const [post] = postsCompra(pagina);
    assert.equal(post.resposta.body.code, 'PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL');
    corpoX = clonar(post.corpo);
    corpoX.itens[0].produto_id = PRODUTO_B.id;
    assert.deepEqual(corpoX.confirmacoes_conversao.map((c) => c.selo_conversao), confX.map((c) => c.selo_conversao));
    assert.deepEqual(await foto([docX.documentoId]), antes);
  });

  const postarX = (alterar) => {
    const corpo = clonar(corpoX);
    alterar(corpo);
    return request(app).post('/api/compras').send(corpo);
  };
  const pendenciaLinha = (resposta, indice) => {
    assert.equal(resposta.status, 422, JSON.stringify(resposta.body));
    assert.equal(resposta.body.code, 'PENDENCIAS_CONVERSAO', JSON.stringify(resposta.body));
    const pendencia = resposta.body.pendencias.find((p) => Number(p.indice) === indice);
    assert.ok(pendencia, `pendência na linha ${indice}: ${JSON.stringify(resposta.body.pendencias)}`);
    assert.equal(pendencia.bloqueia_efetivacao, true);
    assert.equal(pendencia.estado_decisao, 'PENDENTE');
    return pendencia;
  };

  await t.test('confirmação ausente, sem selo, forjada, de outra linha ou de outro documento: recusada sem gravar', async () => {
    const antes = await foto([docX.documentoId, docY.documentoId]);
    const casos = [
      // Sem fator no cadastro (o fator enviado pela tela é ignorado): a proposta é o qTrib na unidade de estoque.
      ['ausente', (c) => { c.confirmacoes_conversao = [c.confirmacoes_conversao[1]]; }, 'QTRIB_UNIDADE_ESTOQUE'],
      ['SIM sem selo', (c) => { delete c.confirmacoes_conversao[0].selo_conversao; }, 'CONFIRMACAO_CONVERSAO_SEM_SELO'],
      ['NÃO sem selo', (c) => { c.confirmacoes_conversao[0].confirmacao = false; c.confirmacoes_conversao[0].selo_conversao = null; }, 'CONFIRMACAO_CONVERSAO_SEM_SELO'],
      ['selo forjado', (c) => { c.confirmacoes_conversao[0].selo_conversao = `v1.${'a'.repeat(64)}`; }, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA'],
      ['selo da outra linha', (c) => { c.confirmacoes_conversao[0].selo_conversao = confX[1].selo_conversao; }, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA'],
      ['confirmação de outro documento', (c) => { c.confirmacoes_conversao[0] = { ...confY[0] }; }, 'DECISAO_NOTA_INCORRETA'],
      ['selo de outro documento com o número deste', (c) => {
        c.confirmacoes_conversao[0] = { ...confY[0], documento_id: docX.documentoId, chave_acesso: null };
      }, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA']
    ];
    for (const [rotulo, alterar, codigo] of casos) {
      const pendencia = pendenciaLinha(await postarX(alterar), 0);
      assert.equal(pendencia.codigo, codigo, rotulo);
      assert.equal(pendencia.selo_conversao, confX[0].selo_conversao, `${rotulo}: servidor reapresenta a proposta desta linha`);
    }
    assert.deepEqual(await foto([docX.documentoId, docY.documentoId]), antes);
  });

  await t.test('unidade de estoque alterada depois da confirmação: o SIM deixa de valer', async () => {
    const antes = await foto([docX.documentoId]);
    await runDb("UPDATE produtos SET unidade = 'L' WHERE id = ?", [PRODUTO_B.id]);
    try {
      const pendencia = pendenciaLinha(await postarX((c) => {
        delete c.itens[0].quantidade_por_embalagem;
        delete c.itens[0].fator_conversao;
      }), 0);
      assert.equal(pendencia.codigo, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA');
      assert.equal(String(pendencia.unidade_estoque).toUpperCase(), 'L');
    } finally {
      await runDb("UPDATE produtos SET unidade = 'UN' WHERE id = ?", [PRODUTO_B.id]);
    }
    assert.deepEqual(await foto([docX.documentoId]), antes);
  });

  await t.test('falha simulada em cada etapa da correção: nada é gravado e a resposta é de falha', async () => {
    const etapas = [
      ['linha do documento (produto, histórico da linha, confirmação anterior)', [
        "CREATE TRIGGER s28_falha AFTER UPDATE OF parse_json ON central_entradas_documentos BEGIN SELECT RAISE(ABORT, 'falha simulada: documento'); END"
      ]],
      ['decisão da sessão de revisão', [
        "CREATE TRIGGER s28_falha BEFORE INSERT ON central_entradas_revisao_itens BEGIN SELECT RAISE(ABORT, 'falha simulada: sessão'); END",
        "CREATE TRIGGER s28_falha2 BEFORE UPDATE ON central_entradas_revisao_itens BEGIN SELECT RAISE(ABORT, 'falha simulada: sessão'); END"
      ]],
      ['histórico da Central (última gravação)', [
        "CREATE TRIGGER s28_falha BEFORE INSERT ON central_entradas_historico BEGIN SELECT RAISE(ABORT, 'falha simulada: histórico'); END"
      ]]
    ];
    for (const [etapa, gatilhos] of etapas) {
      const antes = await foto([docX.documentoId]);
      for (const sql of gatilhos) await runDb(sql);
      let r;
      try {
        r = await request(app).post(rotaLote).send(trocaBparaA);
      } finally {
        await runDb('DROP TRIGGER IF EXISTS s28_falha');
        await runDb('DROP TRIGGER IF EXISTS s28_falha2');
      }
      assert.equal(r.status, 500, `${etapa}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'CORRECAO_NAO_GRAVADA', etapa);
      assert.equal(r.body.sucesso, false, etapa);
      assert.deepEqual(await foto([docX.documentoId]), antes, `${etapa}: rollback completo`);
    }

    // Depois das falhas: a decisão continua B, a confirmação de B continua válida e A continua recusado.
    const linha = (await parseDocumento(docX.documentoId)).itens[0];
    assert.equal(Number(linha.produto_id), PRODUTO_B.id);
    assert.equal(linha.conversao.selo_conversao, confX[0].selo_conversao);
    assert.equal(linha.correcoes_produto, undefined);
    const comA = await postarX((c) => { c.itens[0].produto_id = PRODUTO_A.id; });
    assert.equal(comA.body.code, 'PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL');
  });

  await t.test('falha na correção pela tela: a tela não anuncia sucesso nem tenta gravar a compra', async () => {
    const antes = await foto([docX.documentoId]);
    await runDb("CREATE TRIGGER s28_falha BEFORE INSERT ON central_entradas_historico BEGIN SELECT RAISE(ABORT, 'falha simulada: histórico'); END");
    try {
      const pagina = await abrirTela(app, docX.documentoId, entradaX.dadosCompra);
      pagina.valores.set('#trocaProdutoCentralMotivo', motivo);
      pagina.context.alterarProdutoItemCompra(0, PRODUTO_A.id);
      pagina.context.saveCompra();
      await esperar(() => pagina.notificacoes.some((n) => /troca não foi gravada/.test(n.mensagem)), 'aviso de troca não gravada', pagina);
      assert.equal(postsCorrecao(pagina).length, 1);
      assert.equal(postsCorrecao(pagina)[0].resposta.status, 500);
      assert.equal(postsCompra(pagina).length, 1, 'sem nova tentativa de gravar a compra');
      assert.equal(pagina.notificacoes.some((n) => /Produto trocado|registrada com sucesso/.test(n.mensagem)), false);
    } finally {
      await runDb('DROP TRIGGER IF EXISTS s28_falha');
    }
    assert.deepEqual(await foto([docX.documentoId]), antes);
  });

  await t.test('várias linhas: uma inválida → nenhuma corrigida', async () => {
    const antes = await foto([docX.documentoId]);
    const r = await request(app).post(rotaLote).send({
      linhas: [
        { indice: 0, produto_id: PRODUTO_A.id, produto_anterior_id: PRODUTO_B.id },
        { indice: 1, produto_id: PRODUTO_INATIVO.id, produto_anterior_id: PRODUTO_C.id }
      ],
      motivo
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'PRODUTO_INATIVO');
    const repetida = await request(app).post(rotaLote).send({ linhas: [trocaBparaA.linhas[0], trocaBparaA.linhas[0]], motivo });
    assert.equal(repetida.body.code, 'LINHA_REPETIDA');
    assert.deepEqual(await foto([docX.documentoId]), antes);
  });

  await t.test('correção concluída: linha, decisão, histórico e invalidação gravados juntos; pedido duplicado não duplica', async () => {
    const antes = await foto([docX.documentoId]);
    const [r1, r2] = await Promise.all([
      request(app).post(rotaLote).send(trocaBparaA),
      request(app).post(rotaLote).send(trocaBparaA)
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify([r1.body, r2.body]));
    const ok = r1.status === 200 ? r1 : r2;
    const conflito = r1.status === 200 ? r2 : r1;
    assert.equal(conflito.body.code, 'DECISAO_ALTERADA');
    assert.equal(ok.body.linhas[0].alterado, true);
    assert.equal(ok.body.linhas[0].requer_nova_confirmacao_conversao, true);

    const depois = await foto([docX.documentoId]);
    const parse = await parseDocumento(docX.documentoId);
    assert.equal(Number(parse.itens[0].produto_id), PRODUTO_A.id);
    assert.equal(parse.itens[0].correcoes_produto.length, 1, 'histórico da linha sem duplicar');
    assert.equal(parse.itens[0].conversao, undefined, 'confirmação de B removida');
    assert.equal(parse.itens[1].conversao.selo_conversao, confX[1].selo_conversao, 'linha não corrigida intacta');
    const sessao = depois.documentos[0].revisao.find((l) => Number(l.item_index) === 0);
    assert.equal(Number(sessao.produto_destino_id), PRODUTO_A.id);
    assert.equal(Number(sessao.usuario_id), USUARIO_ID);
    assert.equal(JSON.parse(sessao.dados_json).correcoes_produto.length, 1);
    const novos = depois.documentos[0].historico.slice(antes.documentos[0].historico.length);
    assert.equal(novos.length, 1, 'um registro de histórico');
    assert.match(novos[0].detalhe, /#9802 → #9801/);
    assert.deepEqual(
      { compras: depois.compras, itens: depois.itens, financeiro: depois.financeiro, produtos: depois.produtos, mapeamentos: depois.mapeamentos },
      { compras: antes.compras, itens: antes.itens, financeiro: antes.financeiro, produtos: antes.produtos, mapeamentos: antes.mapeamentos }
    );

    const repetida = await request(app).post(rotaLote).send(trocaBparaA);
    assert.equal(repetida.status, 409);
    assert.equal(repetida.body.code, 'DECISAO_ALTERADA');
    const mesmoProduto = await request(app)
      .post(`/api/central-entradas/${docX.documentoId}/itens/0/corrigir-produto`)
      .send({ produto_id: PRODUTO_A.id, produto_anterior_id: PRODUTO_A.id, motivo });
    assert.equal(mesmoProduto.status, 200);
    assert.equal(mesmoProduto.body.alterado, false);
    assert.deepEqual(await foto([docX.documentoId]), depois, 'repetição não grava nada');
  });

  await t.test('confirmação reaproveitada após troca de produto é recusada (inclusive ao voltar ao produto antigo)', async () => {
    const antes = await foto([docX.documentoId]);
    const comA = pendenciaLinha(await postarX((c) => { c.itens[0].produto_id = PRODUTO_A.id; }), 0);
    assert.equal(comA.codigo, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA');
    assert.equal(Number(comA.produto_id), PRODUTO_A.id);
    assert.deepEqual(await foto([docX.documentoId]), antes);

    const volta = await request(app).post(rotaLote).send({
      linhas: [{ indice: 0, produto_id: PRODUTO_B.id, produto_anterior_id: PRODUTO_A.id }],
      motivo: 'Voltando ao cadastro B após conferência'
    });
    assert.equal(volta.status, 200, JSON.stringify(volta.body));
    const antesVolta = await foto([docX.documentoId]);
    const comBAntigo = pendenciaLinha(await postarX(() => {}), 0);
    assert.equal(comBAntigo.codigo, 'CONFIRMACAO_CONVERSAO_DESATUALIZADA', 'SIM dado a B antes das correções não volta a valer');
    assert.equal(Number(comBAntigo.revisao_produto_linha), 2);
    assert.deepEqual(await foto([docX.documentoId]), antesVolta);
  });

  let gravacaoX;
  await t.test('nova confirmação na Central e gravação: quantidades convertidas uma vez nas duas linhas', async () => {
    const conv = await central.salvarDecisaoConversaoRevisao(docX.documentoId, 0, { decisao: 'SIM', documento_id: docX.documentoId });
    assert.equal(conv.confirmada, true, JSON.stringify(conv));
    assert.notEqual(conv.conversao.selo_conversao, confX[0].selo_conversao);
    entradaX = await central.finalizarEntrada(docX.documentoId, { usuarioId: USUARIO_ID });
    assert.equal(entradaX.dadosCompra.confirmacoes_conversao[1].selo_conversao, confX[1].selo_conversao, 'linha não corrigida mantém o SIM');

    const antes = await foto();
    const tela = await lancarCompraPelaTela(app, { documentoId: docX.documentoId, dadosCompra: entradaX.dadosCompra });
    gravacaoX = tela.gravacao;
    assert.equal(gravacaoX.resposta.status, 200, JSON.stringify(gravacaoX.resposta.body));
    const itens = await allDb('SELECT produto_id, quantidade FROM compras_itens WHERE compra_id = ? ORDER BY id', [gravacaoX.resposta.body.id]);
    assert.deepEqual(itens.map((i) => [Number(i.produto_id), Number(i.quantidade)]), [[PRODUTO_B.id, 20], [PRODUTO_C.id, 12]]);
    const depois = await foto([docX.documentoId]);
    const produto = (f, id) => f.produtos.find((p) => Number(p.id) === id);
    assert.equal(Number(produto(depois, PRODUTO_B.id).saldo_fiscal), Number(produto(antes, PRODUTO_B.id).saldo_fiscal) + 20);
    assert.equal(Number(produto(depois, PRODUTO_C.id).saldo_fiscal), Number(produto(antes, PRODUTO_C.id).saldo_fiscal) + 12);
    assert.deepEqual(produto(depois, PRODUTO_A.id), produto(antes, PRODUTO_A.id), 'produto da troca desfeita sem movimento');
    assert.equal(depois.compras, antes.compras + 1);
    assert.equal(depois.documentos[0].xml, sha(docX.xml), 'XML original preservado');
  });

  await t.test('repetição depois da compra: nada duplicado em compra, estoque, financeiro ou histórico', async () => {
    const antes = await foto([docX.documentoId]);
    const repetida = await request(app).post('/api/compras').send(gravacaoX.corpo);
    assert.ok(repetida.status >= 400, JSON.stringify(repetida.body));
    const correcao = await request(app).post(rotaLote).send({
      linhas: [{ indice: 0, produto_id: PRODUTO_A.id, produto_anterior_id: PRODUTO_B.id }], motivo
    });
    assert.equal(correcao.status, 409);
    assert.equal(correcao.body.code, 'DOCUMENTO_JA_IMPORTADO');
    await assert.rejects(
      () => central.finalizarEntrada(docX.documentoId, { usuarioId: USUARIO_ID }),
      (err) => err.statusCode === 409
    );
    assert.deepEqual(await foto([docX.documentoId]), antes);
  });
});
