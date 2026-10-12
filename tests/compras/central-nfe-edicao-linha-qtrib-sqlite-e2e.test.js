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
  criarPaginaCompras,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const { snapshotXmlLinha } = require('../../backend/services/unidades/ConfirmacaoConversaoEntradaNfe');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');

const FARDO = {
  uCom: 'FD', qCom: 100, vUnCom: 43.9,
  unidadeEstoque: 'UN',
  precoVenda: 5.92
};
const ESPERADO_FARDO = { quantidade: 1000, custo: 4.39, subtotal: 4390, margem: 25.84 };

// FARDO sem embalagem cadastrada (qTrib em UN) exige SIM do operador: coberto pelo teste da Sprint 2.2 abaixo.
const CASOS = [
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

async function aguardarCondicao(condicao, descricao, timeoutMs = 15000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) throw new Error(`Tempo esgotado aguardando: ${descricao}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function contar(tabela, where = '', params = []) {
  const row = await getDb(`SELECT COUNT(*) AS total FROM ${tabela} ${where}`, params);
  return Number(row.total);
}

/** Estado persistente que uma efetivação de compra poderia tocar. */
async function capturarEstado(produtoId, documentoId) {
  const documento = await getDb(
    'SELECT status, xml, parse_json FROM central_entradas_documentos WHERE id = ?',
    [documentoId]
  );
  const itemDocumento = JSON.parse(documento.parse_json || '{}').itens?.[0] || {};
  return {
    compras: await contar('compras'),
    compras_itens: await contar('compras_itens'),
    compras_itens_produto: await contar('compras_itens', 'WHERE produto_id = ?', [produtoId]),
    financeiro: await contar('financeiro'),
    produtos_lotes: await contar('produtos_lotes'),
    movimentos_transferencia_saldos: await contar('movimentos_transferencia_saldos'),
    produtos_preco_historico: await contar('produtos_preco_historico'),
    muc_aprendizado: await contar('muc_aprendizado'),
    muc_aprendizado_produto: await contar('muc_aprendizado', 'WHERE produto_id = ?', [produtoId]),
    produto: await getDb(
      `SELECT unidade, unidade_comercial, quantidade_por_embalagem, estoque_atual,
              saldo_fiscal, saldo_nao_fiscal, preco_compra, preco_venda
       FROM produtos WHERE id = ?`,
      [produtoId]
    ),
    embalagens: await allDb(
      'SELECT tipo, quantidade, unidade, principal, compra, venda, estoque, ativa FROM produto_embalagens WHERE produto_id = ? ORDER BY id',
      [produtoId]
    ),
    documento_status: documento.status,
    documento_xml: documento.xml,
    documento_xml_linha: snapshotXmlLinha(itemDocumento, 0)
  };
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
    const antes = await capturarEstado(caso.id, recebimento.documentoId);
    assert.deepEqual(
      { qCom: antes.documento_xml_linha.qCom, uCom: antes.documento_xml_linha.uCom, qTrib: antes.documento_xml_linha.qTrib, uTrib: antes.documento_xml_linha.uTrib },
      { qCom: 100, uCom: 'FD', qTrib: 1000, uTrib: 'UN' },
      'linha do XML na Central antes da efetivação'
    );

    // Tela de Compras real: abre pela Central, EDITA a linha sem alterar e grava.
    const pagina = criarPaginaCompras(app);
    const modaisConversao = [];
    const abrirModalOriginal = pagina.context.abrirModalConfirmacaoConversaoPendencias;
    pagina.context.abrirModalConfirmacaoConversaoPendencias = (pendencias, payload, ...resto) => {
      modaisConversao.push({ pendencias: JSON.parse(JSON.stringify(pendencias)), payload: JSON.parse(JSON.stringify(payload)) });
      return abrirModalOriginal(pendencias, payload, ...resto);
    };
    pagina.sessao.set('central_abrir_compra', JSON.stringify({
      documentoId: recebimento.documentoId,
      origem: 'CENTRAL_NFE',
      dadosCompra: recebimento.dadosCompra
    }));
    pagina.valores.set('input[name="politica_entrada_import"]:checked', 'REVENDA');
    pagina.context.loadCompras();
    await aguardarCondicao(
      () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem)),
      'tela de Compras carregar a NF-e da Central'
    );
    await editarLinhaSemAlterar(pagina);
    pagina.context.saveCompra();
    await aguardarCondicao(() => modaisConversao.length === 1, 'modal SIM/NÃO após 422');

    // Contrato estruturado do 422 (sem depender de frase literal).
    const postsCompra = () => pagina.requisicoes.filter((r) => r.metodo === 'POST' && r.url === '/api/compras');
    assert.equal(postsCompra().length, 1);
    const resposta = postsCompra()[0].resposta;
    assert.equal(resposta.status, 422, JSON.stringify(resposta.body));
    assert.equal(resposta.body.code, 'PENDENCIAS_CONVERSAO');
    assert.equal(resposta.body.pendencias.length, 1);
    const pendencia = resposta.body.pendencias[0];
    assert.equal(Number(pendencia.produto_id), caso.id);
    assert.equal(pendencia.codigo, 'DIVERGENCIA_QTRIB_FATOR');
    assert.equal(pendencia.estado_decisao, 'PENDENTE');
    assert.equal(pendencia.requer_confirmacao, true);
    assert.equal(pendencia.bloqueia_efetivacao, true);
    assert.equal(pendencia.aprendizado_permanente, false);
    // A tela de Compras envia a unidade comercial já normalizada (FD → FARDO); o XML bruto na Central segue FD.
    assert.ok(['FD', 'FARDO'].includes(String(pendencia.unidade_nf).toUpperCase()), pendencia.unidade_nf);
    assert.equal(Number(pendencia.quantidade_nf), 100);
    assert.equal(String(pendencia.unidade_tributavel).toUpperCase(), 'UN');
    assert.equal(Number(pendencia.quantidade_tributavel), 1000);
    assert.equal(String(pendencia.unidade_estoque).toUpperCase(), 'UN');
    assert.equal(Number(pendencia.quantidade_resultante_proposta), 1000, 'proposta = qTrib na unidade de estoque');
    assert.ok(pendencia.item_key, 'pendência identificada pela linha');
    assert.equal(Number(pendencia.xml_original.qTrib), 1000);
    assert.equal(String(pendencia.xml_original.uTrib).toUpperCase(), 'UN');
    assert.equal(pendencia.xml_original.qCom, 100);

    // A interface recebe a pendência para decisão SIM/NÃO; nada foi exibido como confirmado.
    assert.equal(modaisConversao[0].pendencias[0].item_key, pendencia.item_key);
    assert.equal(
      pagina.notificacoes.filter((n) => /registrada com sucesso/.test(n.mensagem)).length,
      0,
      'nenhuma gravação pode ser anunciada com pendência'
    );

    // Integridade: nada persistido após o 422.
    const depois422 = await capturarEstado(caso.id, recebimento.documentoId);
    assert.deepEqual(depois422, antes, 'HTTP 422 não pode deixar efeito persistente');

    // Retomada pela mesma função que o modal chama ao confirmar as decisões.
    const payloadPendente = modaisConversao[0].payload;
    const montarPayloadDecisao = (confirmacao) => ({
      ...payloadPendente,
      confirmacoes_conversao: [{
        item_key: pendencia.item_key,
        indice: pendencia.indice,
        nItem: pendencia.nItem,
        documento_id: payloadPendente.central_documento_id,
        confirmacao,
        selo_conversao: pendencia.selo_conversao
      }],
      itens: payloadPendente.itens.map((item) => ({ ...item, item_key: pendencia.item_key, confirmacao }))
    });

    // NÃO: recusa a conversão; sem quantidade segura a linha continua pendente e nada é gravado.
    pagina.context.executarGravacaoCompra(montarPayloadDecisao(false), false, false);
    await aguardarCondicao(() => modaisConversao.length === 2, 'modal reaberto após NÃO');
    const respostaNao = postsCompra()[1].resposta;
    assert.equal(respostaNao.status, 422, JSON.stringify(respostaNao.body));
    assert.equal(respostaNao.body.code, 'PENDENCIAS_CONVERSAO');
    assert.equal(respostaNao.body.pendencias[0].codigo, 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA');
    assert.equal(respostaNao.body.pendencias[0].bloqueia_efetivacao, true);
    assert.deepEqual(await capturarEstado(caso.id, recebimento.documentoId), antes, 'NÃO não pode deixar efeito persistente');

    // SIM: backend revalida e grava a quantidade proposta; cadastro e aprendizado ficam intactos.
    pagina.context.executarGravacaoCompra(montarPayloadDecisao(true), false, false);
    await aguardarCondicao(() => postsCompra().length === 3, 'POST após SIM');
    const respostaSim = postsCompra()[2].resposta;
    assert.equal(respostaSim.status, 200, JSON.stringify(respostaSim.body));
    await aguardarCondicao(
      () => pagina.notificacoes.some((n) => /registrada com sucesso|vínculo com a Central/.test(n.mensagem)),
      'retorno da gravação na tela'
    );

    const itensSim = await allDb('SELECT quantidade, quantidade_fiscal, custo_unitario_final, unidade FROM compras_itens WHERE compra_id = ?', [Number(respostaSim.body.id)]);
    assert.equal(itensSim.length, 1);
    assert.equal(Number(itensSim[0].quantidade), Number(pendencia.quantidade_resultante_proposta), 'SIM grava a quantidade validada');
    assert.ok(![1200, 12000].includes(Number(itensSim[0].quantidade)), 'sem fator cadastrado nem dupla conversão sobre qTrib');
    assert.equal(Number(itensSim[0].custo_unitario_final), 4.39);
    assert.equal(String(itensSim[0].unidade).toUpperCase(), 'UN');

    const depoisSim = await capturarEstado(caso.id, recebimento.documentoId);
    assert.equal(depoisSim.compras, antes.compras + 1, 'uma única compra após SIM');
    assert.equal(depoisSim.compras_itens_produto, antes.compras_itens_produto + 1);
    assert.equal(Number(depoisSim.produto.saldo_fiscal), SALDO_FISCAL_INICIAL + 1000);
    assert.equal(depoisSim.produto.unidade, antes.produto.unidade, 'SIM não altera a unidade do produto');
    assert.equal(depoisSim.produto.unidade_comercial, antes.produto.unidade_comercial);
    assert.equal(Number(depoisSim.produto.quantidade_por_embalagem), Number(antes.produto.quantidade_por_embalagem), 'fator cadastrado preservado');
    assert.deepEqual(depoisSim.embalagens, antes.embalagens, 'apresentação FD×12 preservada');
    assert.equal(depoisSim.muc_aprendizado, antes.muc_aprendizado, 'SIM não gera aprendizado permanente');
    assert.deepEqual(depoisSim.documento_xml_linha, antes.documento_xml_linha, 'linha do XML preservada');
  });
});

/** Tela de Compras real aberta pela Central, com espião no modal SIM/NÃO. */
async function abrirTelaCentral(app, recebimento) {
  const pagina = criarPaginaCompras(app);
  const modais = [];
  const abrirModalOriginal = pagina.context.abrirModalConfirmacaoConversaoPendencias;
  pagina.context.abrirModalConfirmacaoConversaoPendencias = (pendencias, payload, ...resto) => {
    modais.push({ pendencias: JSON.parse(JSON.stringify(pendencias)), payload: JSON.parse(JSON.stringify(payload)) });
    return abrirModalOriginal(pendencias, payload, ...resto);
  };
  pagina.sessao.set('central_abrir_compra', JSON.stringify({
    documentoId: recebimento.documentoId,
    origem: 'CENTRAL_NFE',
    dadosCompra: recebimento.dadosCompra
  }));
  pagina.valores.set('input[name="politica_entrada_import"]:checked', 'REVENDA');
  pagina.context.loadCompras();
  await aguardarCondicao(
    () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem)),
    'tela de Compras carregar a NF-e da Central'
  );
  const posts = () => pagina.requisicoes.filter((r) => r.metodo === 'POST' && r.url === '/api/compras');
  return { pagina, modais, posts };
}

test('Sprint 2.2 — EDITAR não substitui o SIM: FD sem embalagem, qCom 100 FD, qTrib 1000 UN', async (t) => {
  const { app, central } = await criarCentral();
  const caso = {
    ...FARDO, uTrib: 'UN', qTrib: 1000, vUnTrib: 4.39,
    apresentacao: null,
    id: 9401, nf: 9401,
    codigo: 'SPRINT4-FD-SEMEMB', gtin: '7891234594017',
    nome: 'BISCOITO SPRINT4 FARDO 10UN'
  };
  await cadastrarProduto(caso);
  const recebimento = await receberPelaCentral(central, caso, { decisao: 'ASSOCIAR', produtoId: caso.id });
  const documentoId = recebimento.documentoId;
  const antes = await capturarEstado(caso.id, documentoId);
  assert.deepEqual(
    { qCom: antes.documento_xml_linha.qCom, uCom: antes.documento_xml_linha.uCom, qTrib: antes.documento_xml_linha.qTrib, uTrib: antes.documento_xml_linha.uTrib },
    { qCom: 100, uCom: 'FD', qTrib: 1000, uTrib: 'UN' }
  );
  const semEfeito = async (rotulo) => {
    assert.deepEqual(await capturarEstado(caso.id, documentoId), antes, `${rotulo}: rejeição não pode deixar efeito persistente`);
  };
  const assertPendenciaConversao = (resposta, rotulo) => {
    assert.equal(resposta.status, 422, `${rotulo}: ${JSON.stringify(resposta.body)}`);
    assert.equal(resposta.body.code, 'PENDENCIAS_CONVERSAO', rotulo);
    const pendencia = resposta.body.pendencias[0];
    assert.equal(Number(pendencia.produto_id), caso.id);
    assert.equal(pendencia.bloqueia_efetivacao, true);
    assert.equal(pendencia.aprendizado_permanente, false);
    assert.equal(Number(pendencia.indice), 0, `${rotulo}: pendência na linha 0 da Central`);
    assert.equal(Number(pendencia.xml_original.qCom), 100, `${rotulo}: qCom oficial`);
    assert.equal(String(pendencia.xml_original.uCom).toUpperCase(), 'FD', `${rotulo}: uCom oficial`);
    assert.equal(Number(pendencia.xml_original.qTrib), 1000, `${rotulo}: qTrib oficial`);
    assert.equal(String(pendencia.xml_original.uTrib).toUpperCase(), 'UN', `${rotulo}: uTrib oficial`);
    return pendencia;
  };

  let payloadTela = null;
  let pendenciaOficial = null;

  await t.test('1. sem editar: 422 com a pendência e modal SIM/NÃO', async () => {
    const tela = await abrirTelaCentral(app, recebimento);
    tela.pagina.context.saveCompra();
    await aguardarCondicao(() => tela.modais.length === 1, 'modal SIM/NÃO');
    pendenciaOficial = assertPendenciaConversao(tela.posts()[0].resposta, 'sem editar');
    assert.equal(pendenciaOficial.codigo, 'QTRIB_UNIDADE_ESTOQUE');
    assert.equal(Number(pendenciaOficial.quantidade_resultante_proposta), 1000);
    await semEfeito('sem editar');
  });

  await t.test('2. editar sem alterar nada continua 422', async () => {
    const tela = await abrirTelaCentral(app, recebimento);
    const editados = await editarLinhaSemAlterar(tela.pagina);
    assert.equal(Number(editados[0].central_item_indice), 0, 'tela preserva a identidade da linha após EDITAR');
    assert.deepEqual(editados[0].linha_nfe_origem, { uCom: 'FD', qCom: 100, uTrib: 'UN', qTrib: 1000 }, 'tela preserva a linha do XML');
    tela.pagina.context.saveCompra();
    await aguardarCondicao(() => tela.modais.length === 1, 'modal SIM/NÃO após EDITAR');
    const corpo = tela.posts()[0].corpo;
    assert.equal(Number(corpo.itens[0].central_item_indice), 0, 'payload: identidade da linha');
    assert.equal(String(corpo.itens[0].uCom).toUpperCase(), 'FD', 'payload: uCom original');
    assert.equal(Number(corpo.itens[0].qCom), 100, 'payload: qCom original');
    assertPendenciaConversao(tela.posts()[0].resposta, 'editar sem alterar');
    payloadTela = tela.modais[0].payload;
    await semEfeito('editar sem alterar');
  });

  const postar = (corpo) => request(app).post('/api/compras').send(corpo);
  const comItem = (alterar) => ({ ...payloadTela, itens: payloadTela.itens.map((item) => alterar({ ...item })) });
  const decisao = (confirmacao, extras = {}) => ({
    item_key: pendenciaOficial.item_key,
    indice: pendenciaOficial.indice,
    nItem: pendenciaOficial.nItem,
    documento_id: documentoId,
    confirmacao,
    selo_conversao: pendenciaOficial.selo_conversao,
    ...extras
  });

  await t.test('3. alterar campos comerciais não elimina a pendência', async () => {
    const resposta = await postar(comItem((item) => ({
      ...item,
      produto_nome: 'BISCOITO DESCRIÇÃO EDITADA',
      precoVendaAtual: 7.5,
      precoVendaAlteradoManualmente: true,
      margem_lucro: 40
    })));
    assertPendenciaConversao(resposta, 'campos comerciais');
    await semEfeito('campos comerciais');
  });

  await t.test('4. identidade da linha removida ou adulterada é rejeitada', async () => {
    const semIdentidade = await postar(comItem((item) => {
      delete item.central_item_indice;
      delete item.nItem;
      delete item.item_key;
      return item;
    }));
    assert.equal(semIdentidade.status, 422, JSON.stringify(semIdentidade.body));
    assert.equal(semIdentidade.body.code, 'LINHA_CENTRAL_NAO_IDENTIFICADA');
    assert.equal(semIdentidade.body.linhas[0].codigo, 'LINHA_CENTRAL_NAO_IDENTIFICADA');

    const inexistente = await postar(comItem((item) => ({ ...item, central_item_indice: 7, nItem: 7, item_key: 'linha:7' })));
    assert.equal(inexistente.status, 422);
    assert.equal(inexistente.body.linhas[0].codigo, 'LINHA_CENTRAL_INEXISTENTE');

    const conflitante = await postar(comItem((item) => ({ ...item, central_item_indice: 0, nItem: 3 })));
    assert.equal(conflitante.status, 422);
    assert.equal(conflitante.body.linhas[0].codigo, 'LINHA_CENTRAL_INEXISTENTE');

    const duplicada = await postar({ ...payloadTela, itens: [payloadTela.itens[0], { ...payloadTela.itens[0] }] });
    assert.equal(duplicada.status, 422);
    assert.ok(duplicada.body.linhas.some((l) => l.codigo === 'LINHA_CENTRAL_DUPLICADA'));

    const semDocumento = await postar({ ...payloadTela, central_documento_id: null });
    assert.equal(semDocumento.status, 422);
    assert.equal(semDocumento.body.code, 'LINHA_CENTRAL_NAO_IDENTIFICADA');

    const outroDocumento = await postar({ ...payloadTela, central_documento_id: 999999 });
    assert.equal(outroDocumento.status, 422);
    assert.equal(outroDocumento.body.code, 'DOCUMENTO_CENTRAL_NAO_ENCONTRADO');
    await semEfeito('identidade adulterada');
  });

  await t.test('5. substituir qCom/uCom/qTrib/uTrib no payload não contorna a validação', async () => {
    const emUnidadeEstoque = await postar(comItem((item) => ({
      ...item,
      uCom: 'UN', qCom: 1000, unidade_comercial: 'UN', quantidade_comercial: 1000,
      uTrib: 'UN', qTrib: 1000, unidade_tributavel: 'UN', quantidade_tributavel: 1000
    })));
    assertPendenciaConversao(emUnidadeEstoque, 'payload em UN');

    const tribEmFardo = await postar(comItem((item) => ({
      ...item,
      uTrib: 'FD', qTrib: 100, unidade_tributavel: 'FD', quantidade_tributavel: 100
    })));
    assertPendenciaConversao(tribEmFardo, 'payload com qTrib em FD');
    await semEfeito('payload adulterado');
  });

  await t.test('6. decisões inválidas não valem como SIM', async () => {
    const semDecisaoValida = [
      ['SIM só no item', { ...comItem((item) => ({ ...item, confirmacao: true, decisao_conversao: true, conversao_decisao: 'SIM', quantidade_estoque_confirmada: 1000, conversao_aplicada: true })), confirmacoes_conversao: [] }],
      ['SIM sem documento', { ...payloadTela, confirmacoes_conversao: [decisao(true, { documento_id: null })] }],
      ['SIM de outra linha', { ...payloadTela, confirmacoes_conversao: [decisao(true, { indice: 5, nItem: 5, item_key: 'linha:5' })] }],
      ['reenvio sem decisão', { ...payloadTela }]
    ];
    for (const [rotulo, corpo] of semDecisaoValida) {
      assertPendenciaConversao(await postar(corpo), rotulo);
    }

    const outraNota = await postar({ ...payloadTela, confirmacoes_conversao: [decisao(true, { documento_id: documentoId + 1000 })] });
    assert.equal(outraNota.status, 422);
    assert.equal(outraNota.body.pendencias[0].codigo, 'DECISAO_NOTA_INCORRETA');

    const nao = await postar({ ...payloadTela, confirmacoes_conversao: [decisao(false)] });
    assert.equal(nao.status, 422);
    assert.equal(nao.body.pendencias[0].codigo, 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA');
    await semEfeito('decisões inválidas');
  });

  await t.test('7–9. SIM válido grava uma única vez, sem alterar cadastro, XML ou aprendizado', async () => {
    const corpoSim = { ...payloadTela, confirmacoes_conversao: [decisao(true)] };
    const sim = await postar(corpoSim);
    assert.equal(sim.status, 200, JSON.stringify(sim.body));

    const itens = await allDb('SELECT quantidade, custo_unitario_final, unidade FROM compras_itens WHERE compra_id = ?', [Number(sim.body.id)]);
    assert.equal(itens.length, 1);
    assert.equal(Number(itens[0].quantidade), 1000);
    assert.equal(Number(itens[0].custo_unitario_final), 4.39);
    assert.equal(String(itens[0].unidade).toUpperCase(), 'UN');

    const repetido = await postar(corpoSim);
    assert.ok([400, 409, 422].includes(repetido.status), `SIM reenviado deve ser rejeitado: ${repetido.status}`);
    t.diagnostic(`SIM reenviado: HTTP ${repetido.status} ${repetido.body.code || ''} ${repetido.body.error || ''}`);

    const semChave = await postar({ ...corpoSim, chave_acesso: '' });
    assert.equal(semChave.status, 422, 'reenvio sem chave também é rejeitado');
    assert.equal(semChave.body.code, 'DOCUMENTO_CENTRAL_JA_EFETIVADO');

    const depois = await capturarEstado(caso.id, documentoId);
    assert.equal(depois.compras, antes.compras + 1, 'uma única compra');
    assert.equal(depois.compras_itens_produto, antes.compras_itens_produto + 1, 'um único item');
    assert.equal(Number(depois.produto.saldo_fiscal), SALDO_FISCAL_INICIAL + 1000);
    assert.equal(depois.produto.unidade, antes.produto.unidade, 'unidade do produto inalterada');
    assert.equal(depois.produto.unidade_comercial, antes.produto.unidade_comercial, 'unidade comercial inalterada');
    assert.equal(Number(depois.produto.quantidade_por_embalagem), Number(antes.produto.quantidade_por_embalagem), 'fator inalterado');
    assert.deepEqual(depois.embalagens, antes.embalagens, 'nenhuma apresentação criada');
    assert.equal(depois.muc_aprendizado, antes.muc_aprendizado, 'nenhum aprendizado permanente');
    assert.equal(depois.documento_xml, antes.documento_xml, 'XML preservado');
    assert.deepEqual(depois.documento_xml_linha, antes.documento_xml_linha, 'linha original preservada');
  });

  await t.test('10. compra manual (fora da Central) continua funcionando', async () => {
    const produtoManual = { ...caso, id: 9409, codigo: 'SPRINT22-MANUAL', nome: 'PRODUTO MANUAL SPRINT 2.2', apresentacao: null, unidadeEstoque: 'UN' };
    await cadastrarProduto(produtoManual);
    const resposta = await postar({
      data_compra: '2026-10-09',
      fornecedor: 'Fornecedor Manual',
      tipo_entrada: 'REVENDA',
      origem_compra: 'MANUAL',
      valor_produtos: 20,
      valor_total_nota: 20,
      total: 20,
      itens: [{
        produto_id: produtoManual.id,
        produto_nome: produtoManual.nome,
        unidade: 'UN',
        unidade_comercial: 'UN',
        quantidade: 5,
        quantidade_comercial: 5,
        quantidade_fiscal: 5,
        quantidade_nao_fiscal: 0,
        preco_unitario: 4,
        custo_unitario_final: 4,
        subtotal: 20
      }]
    });
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    const produto = await getDb('SELECT saldo_fiscal FROM produtos WHERE id = ?', [produtoManual.id]);
    assert.equal(Number(produto.saldo_fiscal), SALDO_FISCAL_INICIAL + 5);
  });
});
