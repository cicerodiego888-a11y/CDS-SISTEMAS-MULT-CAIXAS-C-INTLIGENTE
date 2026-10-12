'use strict';

/**
 * Sprint 3 — produto existente × produto novo na entrada NF-e pela Central.
 *
 * Existente: produto já cadastrado (com saldo fiscal e não fiscal) é reconhecido/associado na revisão.
 * Novo: produto criado pela rota real POST /api/produtos com o payload do cadastro aberto
 * pela revisão da Central (pré-preenchido do XML) e decisão CADASTRAR.
 * Depois: tela de Compras real → POST /api/compras real → SQLite.
 */

const {
  DocumentoFiscalStatus,
  getDb,
  allDb,
  runDb,
  criarCentral,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');

const FARDO = {
  uCom: 'FD', qCom: 100, vUnCom: 43.9,
  apresentacao: { tipo: 'FD', quantidade: 10 },
  unidadeEstoque: 'UN',
  precoVenda: 5.92
};
const FARDO_QTRIB_UN = { ...FARDO, uTrib: 'UN', qTrib: 1000, vUnTrib: 4.39 };
const FARDO_QTRIB_FD = { ...FARDO, uTrib: 'FD', qTrib: 100, vUnTrib: 43.9 };
const ESPERADO_FARDO = { quantidade: 1000, custo: 4.39, subtotal: 4390, margem: 25.84, embalagens: 100, fator: 10 };

const CAIXA = {
  uCom: 'CX', qCom: 10, vUnCom: 120,
  uTrib: 'UN', qTrib: 120, vUnTrib: 10,
  apresentacao: { tipo: 'CX', quantidade: 12 },
  unidadeEstoque: 'UN',
  precoVenda: 12.5
};
const ESPERADO_CAIXA = { quantidade: 120, custo: 10, subtotal: 1200, margem: 20, embalagens: 10, fator: 12 };

const UNIDADE = {
  uCom: 'UN', qCom: 20, vUnCom: 5,
  uTrib: 'UN', qTrib: 20, vUnTrib: 5,
  apresentacao: null,
  unidadeEstoque: 'UN',
  precoVenda: 6
};
const ESPERADO_UNIDADE = { quantidade: 20, custo: 5, subtotal: 100, margem: 16.67, embalagens: 20, fator: null };

const CASOS_EXISTENTE = [
  {
    ...FARDO_QTRIB_UN,
    id: 9301, nf: 9301,
    rotulo: 'EXISTENTE — FARDO reconhecido pelo GTIN cadastrado',
    codigo: 'SPRINT3-EX-FD-GTIN', gtin: '7891234593010', gtinCadastrado: true,
    nome: 'ACUCAR SPRINT3 FARDO 10X1KG',
    custoAnterior: 4.1, saldoFiscalInicial: 30, saldoNaoFiscalInicial: 7,
    esperado: ESPERADO_FARDO
  },
  {
    ...FARDO_QTRIB_FD,
    id: 9302, nf: 9302,
    rotulo: 'EXISTENTE — FARDO sem GTIN no cadastro, associado na revisão (qTrib em FD)',
    codigo: 'SPRINT3-EX-FD-REV', gtin: '7891234593027', gtinCadastrado: false,
    nome: 'CAFE SPRINT3 FARDO 10X500G',
    custoAnterior: 4.1, saldoFiscalInicial: 30, saldoNaoFiscalInicial: 7,
    esperado: ESPERADO_FARDO
  },
  {
    ...CAIXA,
    id: 9303, nf: 9303,
    rotulo: 'EXISTENTE — CAIXA associada na revisão',
    codigo: 'SPRINT3-EX-CX', gtin: '7891234593034', gtinCadastrado: false,
    nome: 'LEITE SPRINT3 CAIXA 12UN',
    custoAnterior: 9.2, saldoFiscalInicial: 30, saldoNaoFiscalInicial: 7,
    esperado: ESPERADO_CAIXA
  },
  {
    ...UNIDADE,
    id: 9304, nf: 9304,
    rotulo: 'EXISTENTE — UN associada na revisão',
    codigo: 'SPRINT3-EX-UN', gtin: '7891234593041', gtinCadastrado: false,
    nome: 'ESCOVA SPRINT3 UNIDADE',
    custoAnterior: 4.5, saldoFiscalInicial: 30, saldoNaoFiscalInicial: 7,
    esperado: ESPERADO_UNIDADE
  }
];

const CASOS_NOVO = [
  {
    ...FARDO_QTRIB_UN,
    nf: 9311,
    rotulo: 'NOVO — FARDO cadastrado com embalagem FD×10 (qTrib em UN)',
    codigo: 'SPRINT3-NV-FD-UN', gtin: '7891234593119',
    nome: 'MACARRAO SPRINT3 FARDO 10X500G',
    cadastrarEmbalagem: true,
    esperado: ESPERADO_FARDO
  },
  {
    ...FARDO_QTRIB_FD,
    nf: 9312,
    rotulo: 'NOVO — FARDO cadastrado com embalagem FD×10 (qTrib em FD)',
    codigo: 'SPRINT3-NV-FD-FD', gtin: '7891234593126',
    nome: 'FARINHA SPRINT3 FARDO 10X1KG',
    cadastrarEmbalagem: true,
    esperado: ESPERADO_FARDO
  },
  {
    ...CAIXA,
    nf: 9313,
    rotulo: 'NOVO — CAIXA cadastrada com embalagem CX×12',
    codigo: 'SPRINT3-NV-CX', gtin: '7891234593133',
    nome: 'SUCO SPRINT3 CAIXA 12UN',
    cadastrarEmbalagem: true,
    esperado: ESPERADO_CAIXA
  },
  {
    ...UNIDADE,
    nf: 9314,
    rotulo: 'NOVO — UN simples',
    codigo: 'SPRINT3-NV-UN', gtin: '7891234593140',
    nome: 'PENTE SPRINT3 UNIDADE',
    cadastrarEmbalagem: false,
    esperado: ESPERADO_UNIDADE
  },
  {
    ...FARDO_QTRIB_UN,
    nf: 9315,
    rotulo: 'NOVO — FARDO cadastrado sem embalagem (MIE recusado), qTrib em UN',
    codigo: 'SPRINT3-NV-FD-SEMEMB', gtin: '7891234593157',
    nome: 'BISCOITO SPRINT3 FARDO 10UN',
    cadastrarEmbalagem: false,
    // Sem fator cadastrado, a quantidade vem da proposta qTrib/uTrib: exige SIM do operador (Sprint 2).
    conversoes: [{ indice: 0, decisao: 'SIM' }],
    esperado: { ...ESPERADO_FARDO, fator: null }
  }
];

async function cadastrarProdutoExistente(caso) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [caso.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [caso.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 1, ?, 'Fornecedor Sprint 3', 1)`,
    [
      caso.id, caso.nome, caso.unidadeEstoque,
      caso.apresentacao ? caso.apresentacao.tipo : caso.unidadeEstoque,
      caso.apresentacao ? caso.apresentacao.quantidade : 1,
      caso.custoAnterior, caso.precoVenda,
      caso.saldoFiscalInicial + caso.saldoNaoFiscalInicial,
      caso.saldoFiscalInicial, caso.saldoNaoFiscalInicial,
      caso.codigo, caso.gtinCadastrado ? caso.gtin : null
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

/**
 * Payload do saveProduto() do cadastro aberto pela revisão da Central ("Cadastrar novo"):
 * nome/GTIN/NCM/custo pré-preenchidos do item da NF-e, unidade base mapeada (FD/CX → un),
 * preço de venda digitado pelo usuário e, com o MIE aceito, a apresentação comercial.
 */
function montarPayloadCadastroCentral(caso, itemParse) {
  const custoPrefill = itemParse?.preco_unitario ?? itemParse?.valor_unitario ?? null;
  const unidadeBase = 'un';
  const embalagens = [{
    id: null, tipo: 'UN', descricao: null, quantidade: 1, unidade: unidadeBase,
    gtin: null, codigo_fornecedor: null, fornecedor_nome: null, valor_compra: 0,
    preco_venda: caso.precoVenda, principal: 1, compra: 0, venda: 1, estoque: 1, ativa: 1
  }];
  if (caso.cadastrarEmbalagem) {
    embalagens.push({
      id: null, tipo: caso.apresentacao.tipo, descricao: null, quantidade: caso.apresentacao.quantidade,
      unidade: unidadeBase, gtin: null, codigo_fornecedor: caso.codigo, fornecedor_nome: null,
      valor_compra: caso.vUnCom,
      preco_venda: Number((caso.precoVenda * caso.apresentacao.quantidade).toFixed(2)),
      principal: 0, compra: 1, venda: 0, estoque: 1, ativa: 1
    });
  }
  return {
    codigo: caso.codigo,
    nome: String(itemParse?.produto_nome || itemParse?.descricao || caso.nome).trim(),
    categoria_id: null,
    subcategoria_id: null,
    marca_id: null,
    observacoes: null,
    imagem_principal: null,
    unidade: unidadeBase,
    preco_compra: Number(custoPrefill) || 0,
    preco_venda: caso.precoVenda,
    lucro_percentual: null,
    estoque_minimo: 0,
    fornecedor: 'Fornecedor Sprint 3',
    data_validade: null,
    lote: '',
    dias_alerta_validade: 30,
    controlar_validade: 0,
    controla_estoque: 1,
    ncm: String(itemParse?.ncm || '00000000'),
    cfop: '5102',
    csosn: '',
    origem: 0,
    cest: '',
    codigo_barras: caso.gtin,
    plu: '',
    aliquota_icms: 0,
    aliquota_pis: 0,
    aliquota_cofins: 0,
    produto_fracionado: 0,
    vendido_por_peso: 0,
    produto_pesavel: 0,
    integrar_balanca: 0,
    permite_venda_unidade: 0,
    peso_medio_unidade: 0,
    preco_unidade: 0,
    venda_atacado: 0,
    compra_por_embalagem: caso.cadastrarEmbalagem ? 1 : 0,
    data_validade_inicial: null,
    saldo_fiscal_inicial: 0,
    saldo_nao_fiscal_inicial: 0,
    item_fiscal: 1,
    embalagens
  };
}

async function cadastrarProdutoNovoPelaRota(app, caso, itemParse) {
  const payload = montarPayloadCadastroCentral(caso, itemParse);
  const resposta = await request(app).post('/api/produtos').send(payload);
  assert.ok([200, 201].includes(resposta.status), `POST /api/produtos: ${resposta.status} ${JSON.stringify(resposta.body)}`);
  const produtoId = Number(resposta.body?.id);
  assert.ok(produtoId > 0, 'cadastro deve devolver o id do produto novo');
  return { produtoId, payload };
}

async function conferirCompraPersistida({ gravacao, recebimento, produtoId, caso, saldoFiscalInicial, saldoNaoFiscalInicial }) {
  const esperado = caso.esperado;
  assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
  assert.equal(gravacao.corpo.origem_compra, 'CENTRAL_NFE');
  assert.equal(Number(gravacao.corpo.central_documento_id), recebimento.documentoId);
  const itemPayload = gravacao.corpo.itens[0];
  assert.equal(Number(itemPayload.produto_id), produtoId, 'payload: produto');
  assert.equal(Number(itemPayload.quantidade), esperado.quantidade, 'payload: quantidade');
  assert.equal(Number(itemPayload.custo_unitario_final), esperado.custo, 'payload: custo unitário');
  assert.equal(Number(itemPayload.subtotal), esperado.subtotal, 'payload: subtotal');

  const compraId = Number(gravacao.resposta.body.id);
  const compra = await getDb('SELECT * FROM compras WHERE id = ?', [compraId]);
  assert.ok(compra, 'compras: cabeçalho persistido');
  assert.equal(Number(compra.total ?? compra.valor_total), esperado.subtotal, 'compras.total');

  const itens = await allDb('SELECT * FROM compras_itens WHERE compra_id = ?', [compraId]);
  assert.equal(itens.length, 1, 'compras_itens: um item');
  const item = itens[0];
  assert.equal(Number(item.produto_id), produtoId, 'compras_itens.produto_id');
  assert.equal(Number(item.quantidade), esperado.quantidade, 'compras_itens.quantidade');
  assert.equal(Number(item.quantidade_fiscal), esperado.quantidade, 'compras_itens.quantidade_fiscal');
  assert.equal(Number(item.quantidade_nao_fiscal), 0, 'compras_itens.quantidade_nao_fiscal');
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

  const produto = await getDb(
    `SELECT unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_compra, preco_venda
     FROM produtos WHERE id = ?`,
    [produtoId]
  );
  assert.equal(String(produto.unidade).toUpperCase(), caso.unidadeEstoque, 'produtos.unidade');
  assert.equal(Number(produto.saldo_fiscal), saldoFiscalInicial + esperado.quantidade, 'produtos.saldo_fiscal');
  assert.equal(Number(produto.saldo_nao_fiscal), saldoNaoFiscalInicial, 'produtos.saldo_nao_fiscal preservado');
  assert.equal(
    Number(produto.estoque_atual),
    saldoFiscalInicial + saldoNaoFiscalInicial + esperado.quantidade,
    'produtos.estoque_atual'
  );
  assert.equal(Number(produto.preco_compra), esperado.custo, 'produtos.preco_compra');
  assert.equal(Number(produto.preco_venda), caso.precoVenda, 'produtos.preco_venda não muda');
  return { compraId, item, produto };
}

test('Sprint 3 — produto existente × produto novo pela Central NF-e até o SQLite', async (t) => {
  const { app, central } = await criarCentral();
  const gravacoesPorNf = new Map();

  for (const caso of CASOS_EXISTENTE) {
    await t.test(caso.rotulo, async () => {
      await cadastrarProdutoExistente(caso);
      const recebimento = await receberPelaCentral(central, caso, { decisao: 'ASSOCIAR', produtoId: caso.id });
      t.diagnostic(`${caso.rotulo}: status inicial ${recebimento.statusInicial}`);

      const itemCentral = recebimento.dadosCompra.itens[0];
      assert.equal(Number(itemCentral.produto_id), caso.id, 'Central deve entregar o produto existente');
      if (!caso.gtinCadastrado) {
        assert.equal(recebimento.statusInicial, DocumentoFiscalStatus.EM_REVISAO, 'sem GTIN cadastrado a Central pede revisão');
      }

      const produtosAntes = await getDb('SELECT COUNT(*) AS total FROM produtos');
      const { itensTela, custoTela, gravacao } = await lancarCompraPelaTela(app, recebimento);
      assert.equal(Number(itensTela[0].quantidade_convertida), caso.esperado.quantidade, 'tela: quantidade de estoque');
      assert.equal(Number(custoTela[0]), caso.esperado.custo, 'tela: custo unitário');

      await conferirCompraPersistida({
        gravacao, recebimento, produtoId: caso.id, caso,
        saldoFiscalInicial: caso.saldoFiscalInicial,
        saldoNaoFiscalInicial: caso.saldoNaoFiscalInicial
      });
      const produtosDepois = await getDb('SELECT COUNT(*) AS total FROM produtos');
      assert.equal(Number(produtosDepois.total), Number(produtosAntes.total), 'produto existente não pode gerar cadastro duplicado');
    });
  }

  for (const caso of CASOS_NOVO) {
    await t.test(caso.rotulo, async () => {
      const existente = await getDb('SELECT id FROM produtos WHERE codigo_barras = ? OR codigo = ?', [caso.gtin, caso.codigo]);
      assert.equal(existente, undefined, 'produto ainda não pode existir antes da NF-e');

      let cadastro = null;
      const recebimento = await receberPelaCentral(central, caso, {
        decisao: 'CADASTRAR',
        produtoId: async (itemParse) => {
          cadastro = await cadastrarProdutoNovoPelaRota(app, caso, itemParse);
          return cadastro.produtoId;
        },
        conversoes: caso.conversoes
      });
      for (const conv of recebimento.conversoes) {
        assert.equal(conv.confirmada, true, `SIM deve ser confirmado pelo backend: ${JSON.stringify(conv)}`);
        assert.equal(Number(conv.resultado_backend?.quantidade_estoque), caso.esperado.quantidade, 'SIM: quantidade validada no backend');
      }
      t.diagnostic(`${caso.rotulo}: status inicial ${recebimento.statusInicial}; custo pré-preenchido no cadastro ${cadastro?.payload.preco_compra}`);
      assert.equal(recebimento.statusInicial, DocumentoFiscalStatus.EM_REVISAO, 'produto desconhecido deve cair na revisão');
      assert.ok(cadastro, 'decisão CADASTRAR deve criar o produto pelo cadastro');

      const produtoCriado = await getDb('SELECT unidade, saldo_fiscal, saldo_nao_fiscal, preco_venda FROM produtos WHERE id = ?', [cadastro.produtoId]);
      assert.equal(String(produtoCriado.unidade).toUpperCase(), 'UN', 'cadastro: unidade base');
      assert.equal(Number(produtoCriado.saldo_fiscal || 0), 0, 'cadastro: nasce sem saldo fiscal');
      const embalagensCriadas = await allDb(
        'SELECT tipo, quantidade, unidade, compra, ativa FROM produto_embalagens WHERE produto_id = ? AND ativa = 1',
        [cadastro.produtoId]
      );
      if (caso.cadastrarEmbalagem) {
        assert.ok(
          embalagensCriadas.some((e) => String(e.tipo).toUpperCase() === caso.apresentacao.tipo
            && Number(e.quantidade) === caso.apresentacao.quantidade),
          `cadastro: apresentação ${caso.apresentacao.tipo}×${caso.apresentacao.quantidade} persistida: ${JSON.stringify(embalagensCriadas)}`
        );
      }

      const itemCentral = recebimento.dadosCompra.itens[0];
      assert.equal(Number(itemCentral.produto_id), cadastro.produtoId, 'Central deve entregar o produto recém-cadastrado');

      const produtosAntes = await getDb('SELECT COUNT(*) AS total FROM produtos');
      const { itensTela, custoTela, gravacao } = await lancarCompraPelaTela(app, recebimento);
      assert.equal(Number(itensTela[0].quantidade_convertida), caso.esperado.quantidade, 'tela: quantidade de estoque');
      assert.equal(Number(custoTela[0]), caso.esperado.custo, 'tela: custo unitário');

      if (!caso.cadastrarEmbalagem && caso.apresentacao) {
        assert.equal(Number(gravacao.corpo.itens[0].quantidade_tributavel), caso.qTrib, 'payload: qTrib do XML');
        assert.equal(String(gravacao.corpo.itens[0].unidade_tributavel).toUpperCase(), caso.uTrib, 'payload: uTrib do XML');
      }

      await conferirCompraPersistida({
        gravacao, recebimento, produtoId: cadastro.produtoId, caso,
        saldoFiscalInicial: 0,
        saldoNaoFiscalInicial: 0
      });
      const produtosDepois = await getDb('SELECT COUNT(*) AS total FROM produtos');
      assert.equal(Number(produtosDepois.total), Number(produtosAntes.total), 'gravar a compra não pode criar outro produto');
      gravacoesPorNf.set(caso.nf, { corpo: gravacao.corpo, produtoId: cadastro.produtoId });
    });
  }

  await t.test('conversão impossível no backend é bloqueada antes da transação (422) e libera a conexão', async () => {
    const base = gravacoesPorNf.get(9315);
    assert.ok(base, 'depende do caso NOVO — FARDO sem embalagem');
    const corpo = JSON.parse(JSON.stringify(base.corpo));
    delete corpo.central_documento_id;
    delete corpo.chave_acesso;
    corpo.numero_nf = '99315';
    delete corpo.itens[0].quantidade_tributavel;
    delete corpo.itens[0].unidade_tributavel;

    const comprasAntes = await getDb('SELECT COUNT(*) AS total FROM compras');
    const produtoAntes = await getDb('SELECT saldo_fiscal, estoque_atual FROM produtos WHERE id = ?', [base.produtoId]);
    const resposta = await request(app).post('/api/compras').send(corpo).timeout({ response: 15000 });
    // Sprint 2: a validação de conversão roda antes do BEGIN. O SIM gravado para a proposta qTrib
    // não autoriza a linha sem qTrib: o backend revalida e mantém a linha pendente.
    assert.equal(resposta.status, 422, JSON.stringify(resposta.body));
    assert.equal(resposta.body.code, 'PENDENCIAS_CONVERSAO');
    t.diagnostic(`conversão impossível: ${resposta.body.error}`);
    assert.match(String(resposta.body.error || ''), /fator|convers|unidade/i, 'erro deve vir da conversão da NF-e');
    const pendencia = resposta.body.pendencias?.[0];
    assert.ok(pendencia, 'pendência por linha deve ser devolvida');
    assert.equal(pendencia.bloqueia_efetivacao, true);
    assert.equal(pendencia.aprendizado_permanente, false);

    const comprasDepois = await getDb('SELECT COUNT(*) AS total FROM compras');
    assert.equal(Number(comprasDepois.total), Number(comprasAntes.total), 'compra não pode ser gravada');
    const produtoDepois = await getDb('SELECT saldo_fiscal, estoque_atual FROM produtos WHERE id = ?', [base.produtoId]);
    assert.deepEqual(produtoDepois, produtoAntes, 'estoque não pode mudar');
    await runDb('BEGIN IMMEDIATE');
    await runDb('ROLLBACK');
  });
});
