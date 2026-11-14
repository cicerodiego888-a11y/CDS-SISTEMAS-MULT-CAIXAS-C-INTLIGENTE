'use strict';

const {
  db,
  runDb,
  getDb,
  criarCentral,
  criarPaginaCompras,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const request = require('supertest');
const { obterMuc } = require('../../backend/motores/muc');

async function aguardar(condicao, descricao) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > 15000) throw new Error(`Timeout: ${descricao}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

after(async () => {
  await new Promise((resolve) => db.close(resolve));
});

test('FRD6: preserva a apresentação legada escolhida e grava uma vez', async () => {
  const { app, central } = await criarCentral();
  await runDb(
    `INSERT INTO produtos
      (id, nome, unidade, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem,
       valor_compra_embalagem, preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ativo)
     VALUES (99191, ?, 'UN', 'PCT', 6, 1, 84, 14, 20, 0, 0, 0, 1)`,
    ['ESM. SINTETICO PRETO LT 0,750L']
  );
  const rec = await receberPelaCentral(central, {
    id: 99191, nf: 99191, codigo: 'FRD6-TESTE', gtin: 'SEM GTIN',
    nome: 'ESM. SINTETICO PRETO LT 0,750L',
    uCom: 'FRD6', qCom: 1, vUnCom: 84, uTrib: 'FRD6', qTrib: 1, vUnTrib: 84
  }, {
    decisao: 'ASSOCIAR', produtoId: 99191, conversoes: [{ indice: 0, decisao: 'SIM' }]
  });

  const item = rec.dadosCompra.itens[0];
  const body = {
    ...rec.dadosCompra,
    data_compra: '2026-10-02',
    total: 84,
    valor_total_nota: 84,
    valor_produtos: 84,
    tipo_entrada: 'REVENDA',
    itens: [{
      ...item,
      produto_id: 99191,
      quantidade: 6,
      quantidade_comercial: 1,
      quantidade_convertida: 6,
      quantidade_fiscal: 6,
      quantidade_nao_fiscal: 0,
      quantidade_por_embalagem: 6,
      compra_em: 'PCT',
      subtotal: 84,
      preco_unitario: 14,
      preco_unitario_comercial: 84
    }]
  };
  const response = await request(app).post('/api/compras').send(body);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const gravado = await getDb(
    'SELECT quantidade, quantidade_embalagens, quantidade_por_embalagem, custo_unitario_final, subtotal FROM compras_itens WHERE compra_id = ?',
    [response.body.id]
  );
  assert.equal(gravado.quantidade, 6);
  assert.equal(gravado.quantidade_embalagens, 1);
  assert.equal(gravado.quantidade_por_embalagem, 6);
  assert.equal(gravado.custo_unitario_final, 14);
  assert.equal(gravado.subtotal, 84);
});

test('FRD6: seleção de pacote na tela preserva múltiplas embalagens', async () => {
  const { app, central } = await criarCentral();
  await runDb(
    `INSERT INTO produtos
      (id, nome, unidade, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem,
       valor_compra_embalagem, preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ativo)
     VALUES (99192, ?, 'UN', 'PCT', 6, 1, 84, 14, 20, 0, 0, 0, 1)`,
    ['ESM. SINTETICO PRETO LT 0,750L']
  );
  const rec = await receberPelaCentral(central, {
    id: 99192, nf: 99192, codigo: 'FRD6-MULTIPLOS', gtin: 'SEM GTIN',
    nome: 'ESM. SINTETICO PRETO LT 0,750L',
    uCom: 'FRD6', qCom: 3, vUnCom: 84, uTrib: 'FRD6', qTrib: 3, vUnTrib: 84
  }, {
    decisao: 'ASSOCIAR', produtoId: 99192, conversoes: [{ indice: 0, decisao: 'SIM' }]
  });
  const tela = await lancarCompraPelaTela(app, rec, {
    antesDeGravar: async (pagina) => {
      pagina.context.editarItemCompra(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const pacote = pagina.avaliar('embalagensProdutoCompraAtual').find((e) => Number(e.quantidade) === 6);
      assert.ok(pacote, 'opção cadastrada de pacote com seis unidades');
      pagina.valores.set('#embalagem_compra_item', String(pacote.id));
      pagina.context.onEmbalagemCompraSelecionada();
      await pagina.context.adicionarItemCompraAsync();
      assert.equal(pagina.avaliar('indiceEditandoCompra'), null);
      const linha = pagina.avaliar('itensCompraAtual')[0];
      assert.equal(Number(linha.quantidade_convertida), 18);
      assert.equal(Number(linha.custo_unitario_final), 14);
    }
  });
  assert.equal(tela.gravacao.resposta.status, 200, JSON.stringify(tela.gravacao.resposta.body));
  const gravado = await getDb(
    `SELECT quantidade, quantidade_embalagens, quantidade_por_embalagem, custo_unitario_final, subtotal
       FROM compras_itens WHERE compra_id = ?`,
    [tela.gravacao.resposta.body.id]
  );
  assert.equal(gravado.quantidade, 18);
  assert.equal(gravado.quantidade_embalagens, 3);
  assert.equal(gravado.quantidade_por_embalagem, 6);
  assert.equal(gravado.custo_unitario_final, 14);
  assert.equal(gravado.subtotal, 252);
});

test('FRD6: divergência real e falha de persistência não gravam efeitos', async () => {
  const { app, central } = await criarCentral();
  await runDb(
    `INSERT INTO produtos
      (id, nome, unidade, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem,
       valor_compra_embalagem, preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ativo)
     VALUES (99193, ?, 'UN', 'PCT', 6, 1, 84, 14, 20, 0, 0, 0, 1)`,
    ['ESM. SINTETICO PRETO LT 0,750L']
  );
  const rec = await receberPelaCentral(central, {
    id: 99193, nf: 99193, codigo: 'FRD6-ROLLBACK', gtin: 'SEM GTIN',
    nome: 'ESM. SINTETICO PRETO LT 0,750L',
    uCom: 'FRD6', qCom: 1, vUnCom: 84, uTrib: 'FRD6', qTrib: 1, vUnTrib: 84
  }, {
    decisao: 'ASSOCIAR', produtoId: 99193, conversoes: [{ indice: 0, decisao: 'SIM' }]
  });
  const body = {
    ...rec.dadosCompra, data_compra: '2026-10-02', total: 84, valor_total_nota: 84,
    valor_produtos: 84, tipo_entrada: 'REVENDA',
    itens: [{
      ...rec.dadosCompra.itens[0], produto_id: 99193, quantidade: 6, quantidade_comercial: 1,
      quantidade_convertida: 6, quantidade_fiscal: 6, quantidade_nao_fiscal: 0,
      quantidade_por_embalagem: 6, compra_em: 'PCT', subtotal: 84,
      preco_unitario: 14, preco_unitario_comercial: 84
    }]
  };
  const foto = async () => ({
    compras: await getDb('SELECT COUNT(*) AS n FROM compras'),
    itens: await getDb('SELECT COUNT(*) AS n FROM compras_itens'),
    financeiro: await getDb('SELECT COUNT(*) AS n FROM financeiro'),
    lotes: await getDb('SELECT COUNT(*) AS n FROM produtos_lotes'),
    movimentos: await getDb('SELECT COUNT(*) AS n FROM movimentos_transferencia_saldos'),
    historico_precos: await getDb('SELECT COUNT(*) AS n FROM produtos_preco_historico'),
    produto: await getDb('SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?', [99193]),
    documento: await getDb('SELECT status, compra_id, parse_json FROM central_entradas_documentos WHERE id = ?', [rec.documentoId]),
    historico: await getDb('SELECT COUNT(*) AS n FROM central_entradas_historico WHERE documento_id = ?', [rec.documentoId])
  });
  const antes = await foto();
  const muc = obterMuc(db);
  const original = muc.processarItemCompra;
  try {
    muc.processarItemCompra = function (...args) {
      const callback = args.pop();
      return original.call(this, ...args, (erro, resultado) => {
        callback(erro, erro ? resultado : { ...resultado, quantidadeEstoque: 12 });
      });
    };
    const resposta = await request(app).post('/api/compras').send(body);
    assert.equal(resposta.status, 422, JSON.stringify(resposta.body));
    assert.equal(resposta.body.code, 'CONVERSAO_EFETIVA_DIVERGENTE');
  } finally {
    muc.processarItemCompra = original;
  }
  assert.deepEqual(await foto(), antes);

  await runDb("CREATE TRIGGER frd6_falha BEFORE INSERT ON compras_itens BEGIN SELECT RAISE(ABORT, 'falha simulada de persistencia'); END");
  try {
    const resposta = await request(app).post('/api/compras').send(body);
    assert.ok(resposta.status >= 400, JSON.stringify(resposta.body));
  } finally {
    await runDb('DROP TRIGGER frd6_falha');
  }
  assert.deepEqual(await foto(), antes);
  const resposta = await request(app).post('/api/compras').send(body);
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
});

test('FRD6: escolha de apresentação não padrão é preservada na tela e no banco', async () => {
  const { app, central } = await criarCentral();
  await runDb(
    `INSERT INTO produtos
      (id, nome, unidade, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem,
       preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ativo)
     VALUES (99194, ?, 'UN', 'UN', 1, 1, 14, 20, 0, 0, 0, 1)`,
    ['ESM. SINTETICO PRETO LT 0,750L']
  );
  await runDb(`INSERT INTO produto_embalagens
    (produto_id, tipo, quantidade, unidade, principal, compra, venda, estoque, ativa)
    VALUES (99194, 'PCT', 4, 'UN', 1, 1, 1, 1, 1), (99194, 'CX', 6, 'UN', 0, 1, 1, 1, 1)`);
  const escolhida = await getDb("SELECT id FROM produto_embalagens WHERE produto_id = 99194 AND tipo = 'CX'");
  const rec = await receberPelaCentral(central, {
    id: 99194, nf: 99194, codigo: 'FRD6-NAO-PADRAO', gtin: 'SEM GTIN',
    nome: 'ESM. SINTETICO PRETO LT 0,750L',
    uCom: 'FRD6', qCom: 1, vUnCom: 84, uTrib: 'FRD6', qTrib: 1, vUnTrib: 84
  }, {
    decisao: 'ASSOCIAR', produtoId: 99194, conversoes: [{ indice: 0, decisao: 'SIM' }]
  });
  const tela = await lancarCompraPelaTela(app, rec, {
    antesDeGravar: async (pagina) => {
      pagina.context.editarItemCompra(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const opcao = pagina.avaliar('embalagensProdutoCompraAtual')
        .find((e) => Number(e.embalagem_ref_id || e.id) === escolhida.id);
      assert.ok(opcao, 'apresentação não padrão disponível na tela');
      pagina.valores.set('#embalagem_compra_item', String(opcao.id));
      pagina.context.onEmbalagemCompraSelecionada();
      await pagina.context.adicionarItemCompraAsync();
      const linha = pagina.avaliar('itensCompraAtual')[0];
      assert.equal(Number(linha.quantidade_convertida), 6);
      assert.equal(Number(linha.custo_unitario_final), 14);
    }
  });
  const gravado = await getDb(
    'SELECT produto_apresentacao_id, quantidade, quantidade_por_embalagem, custo_unitario_final, subtotal FROM compras_itens WHERE compra_id = ?',
    [tela.gravacao.resposta.body.id]
  );
  assert.equal(gravado.produto_apresentacao_id, escolhida.id);
  assert.equal(gravado.quantidade, 6);
  assert.equal(gravado.quantidade_por_embalagem, 6);
  assert.equal(gravado.custo_unitario_final, 14);
  assert.equal(gravado.subtotal, 84);
});

test('fator manual: tela → confirmação assinada pelo backend → MUC → compra e estoque', async () => {
  const { app, central } = await criarCentral();
  await runDb(
    `INSERT INTO produtos
      (id, nome, unidade, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem,
       preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ativo)
     VALUES (99195, ?, 'UN', 'PCT', 4, 1, 21, 20, 0, 0, 0, 1)`,
    ['ESM. SINTETICO PRETO LT 0,750L']
  );
  await runDb(`INSERT INTO produto_embalagens
    (produto_id, tipo, quantidade, unidade, principal, compra, venda, estoque, ativa, valor_compra)
    VALUES (99195, 'PCT', 4, 'UN', 1, 1, 1, 1, 1, 84)`);
  const recebimento = await receberPelaCentral(central, {
    id: 99195, nf: 99195, codigo: 'FRD6-FATOR-MANUAL', gtin: 'SEM GTIN',
    nome: 'ESM. SINTETICO PRETO LT 0,750L',
    uCom: 'PCT', qCom: 1, vUnCom: 84, uTrib: 'PCT', qTrib: 1, vUnTrib: 84
  }, { decisao: 'ASSOCIAR', produtoId: 99195 });
  const saldoInicial = await getDb(
    'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?',
    [99195]
  );
  const pagina = criarPaginaCompras(app);
  pagina.sessao.set('central_abrir_compra', JSON.stringify({
    documentoId: recebimento.documentoId,
    origem: 'CENTRAL_NFE',
    dadosCompra: recebimento.dadosCompra
  }));
  pagina.valores.set('input[name="politica_entrada_import"]:checked', 'REVENDA');
  pagina.context.loadCompras();
  await aguardar(
    () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem)),
    'produto e documento carregados na interface'
  );
  pagina.context.editarItemCompra(0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const valorAnterior = Number(pagina.avaliar('itemDraftCompra.quantidade_por_embalagem'));
  assert.equal(valorAnterior, 4, 'fator cadastrado carregado antes da edição');
  pagina.valores.set('#quantidade_por_embalagem_item', '6');
  pagina.disparar('#quantidade_por_embalagem_item', 'input.conversaoCentral');
  await pagina.context.adicionarItemCompraAsync();
  assert.equal(pagina.avaliar('indiceEditandoCompra'), null, 'edição manual concluída na interface');
  assert.equal(Number(pagina.avaliar('itensCompraAtual[0].quantidade_por_embalagem')), 6);
  assert.equal(Number(pagina.avaliar('itensCompraAtual[0].quantidade_convertida')), 6);
  assert.equal(Number(pagina.avaliar('itensCompraAtual[0].custo_unitario_final')), 14);

  const muc = obterMuc(db);
  const original = muc.processarItemCompra;
  const autorizacoesRecebidas = [];
  muc.processarItemCompra = function (item, produto, opcoes, callback) {
    autorizacoesRecebidas.push(opcoes?.autorizacaoConversao || null);
    return original.call(this, item, produto, opcoes, callback);
  };
  try {
    pagina.context.saveCompra();
    await aguardar(
      () => pagina.requisicoes.some((r) => r.metodo === 'POST' && r.url === '/api/compras'),
      'primeiro POST de validação da conversão manual'
    );
    const primeira = pagina.requisicoes.find((r) => r.metodo === 'POST' && r.url === '/api/compras');
    assert.equal(primeira.resposta.status, 422, 'fator manual exige confirmação explícita');
    assert.equal(primeira.resposta.body.code, 'PENDENCIAS_CONVERSAO');
    const pendencia = primeira.resposta.body.pendencias[0];
    assert.equal(Number(pendencia.fator_conversao_validado), 6);
    assert.equal(Number(pendencia.quantidade_resultante_proposta), 6);
    assert.ok(pendencia.produto_apresentacao_id, 'backend vincula a apresentação cadastrada');
    assert.match(pendencia.selo_conversao, /^v2\.[0-9a-f]{64}$/, 'backend emite autorização assinada');
    await aguardar(
      () => pagina.htmlAnexados.some((html) => html.includes('confirmacaoConversaoUnidadesModal')),
      'modal da interface para confirmar a proposta backend'
    );
    const modalSeletor = '#confirmacaoConversaoUnidadesModal';
    pagina.disparar(modalSeletor, 'click', {
      dataset: { itemKey: pendencia.item_key, decisao: 'true' }
    });
    pagina.clicar('#confirmacaoConversaoUnidadesModal-confirmar');
    await aguardar(
      () => pagina.notificacoes.some((n) => /registrada com sucesso/.test(n.mensagem)),
      'compra concluída após confirmação'
    );
  } finally {
    muc.processarItemCompra = original;
  }

  const posts = pagina.requisicoes.filter((r) => r.metodo === 'POST' && r.url === '/api/compras');
  assert.equal(posts.length, 2, 'validação pendente seguida da gravação autorizada');
  assert.equal(posts[1].resposta.status, 200);
  assert.equal(posts[1].corpo.confirmacoes_conversao[0].selo_conversao, posts[0].resposta.body.pendencias[0].selo_conversao);
  assert.equal(autorizacoesRecebidas.length, 1, 'MUC chamado apenas após confirmação do operador');
  assert.equal(autorizacoesRecebidas[0].fator, 6);
  assert.equal(autorizacoesRecebidas[0].quantidade, 6);
  assert.equal(autorizacoesRecebidas[0].apresentacaoId, posts[0].resposta.body.pendencias[0].produto_apresentacao_id);

  const gravado = await getDb(
    `SELECT produto_apresentacao_id, quantidade, quantidade_embalagens, quantidade_por_embalagem,
            custo_unitario_final, subtotal
       FROM compras_itens WHERE compra_id = ?`,
    [posts[1].resposta.body.id]
  );
  assert.equal(gravado.produto_apresentacao_id, autorizacoesRecebidas[0].apresentacaoId);
  assert.equal(gravado.quantidade, 6);
  assert.equal(gravado.quantidade_embalagens, 1);
  assert.equal(gravado.quantidade_por_embalagem, 6);
  assert.equal(gravado.custo_unitario_final, 14);
  assert.equal(gravado.subtotal, 84);
  const saldoFinal = await getDb(
    'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?',
    [99195]
  );
  assert.equal(Number(saldoFinal.estoque_atual) - Number(saldoInicial.estoque_atual), 6);
  assert.equal(Number(saldoFinal.saldo_fiscal) - Number(saldoInicial.saldo_fiscal), 6);
  assert.equal(Number(saldoFinal.saldo_nao_fiscal), Number(saldoInicial.saldo_nao_fiscal));
});
