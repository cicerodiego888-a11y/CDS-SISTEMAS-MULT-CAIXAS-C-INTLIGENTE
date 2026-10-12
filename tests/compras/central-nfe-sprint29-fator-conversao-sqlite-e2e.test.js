'use strict';

/**
 * Sprint 2.9 — fator de conversão da NF-e da Central decidido pelo backend (cadastro do produto via MUC).
 * Central real → tela de Compras real (VM) → rota real → SQLite temporário.
 * O corpo que a tela enviaria é capturado (sem gravar) e adulterado: fator, tipo de conversão, apresentação
 * e quantidades convertidas vindos da tela não podem mudar a quantidade gravada no estoque.
 */

const {
  db,
  getDb,
  allDb,
  runDb,
  criarCentral,
  criarPaginaCompras,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { test } = require('node:test');
const request = require('supertest');
const { obterMuc } = require('../../backend/motores/muc');
const MotorUnidadesMedida = require('../../backend/services/unidades/MotorUnidadesMedida');
const ConfirmacaoConversaoEntradaNfe = require('../../backend/services/unidades/ConfirmacaoConversaoEntradaNfe');

function ean13(base12) {
  const soma = [...base12].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (soma % 10)) % 10}`;
}

const PRODUTOS = {
  semFator: { id: 9901, nome: 'BISCOITO SPRINT29 SEM FATOR', unidadeComercial: 'UN', qpe: 0, gtin: ean13('789804392901') },
  apresentacao: {
    id: 9902, nome: 'SUCO SPRINT29 PACOTE X4', unidadeComercial: 'UN', qpe: 0, gtin: ean13('789804392902'),
    apresentacao: { tipo: 'PCT', quantidade: 4 }
  },
  outro: {
    id: 9903, nome: 'COPO SPRINT29 CAIXA X500', unidadeComercial: 'UN', qpe: 0, gtin: ean13('789804392903'),
    apresentacao: { tipo: 'CX', quantidade: 500 }
  },
  legado: { id: 9904, nome: 'AGUA SPRINT29 FARDO LEGADO X4', unidadeComercial: 'PCT', qpe: 4, gtin: ean13('789804392904') },
  qtrib: { id: 9905, nome: 'IOGURTE SPRINT29 QTRIB', unidadeComercial: 'UN', qpe: 0, gtin: ean13('789804392905') }
};

// 5 PCT na nota; a quantidade em estoque correta é sempre 20 UN.
const LINHA_PCT_PCT = { uCom: 'PCT', qCom: 5, vUnCom: 48, uTrib: 'PCT', qTrib: 5, vUnTrib: 48 };
const LINHA_PCT_UN = { uCom: 'PCT', qCom: 5, vUnCom: 48, uTrib: 'UN', qTrib: 20, vUnTrib: 12 };

const sha = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor ?? null), 'utf8').digest('hex');
const clonar = (valor) => JSON.parse(JSON.stringify(valor));

async function cadastrar(produto) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [produto.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [produto.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', ?, ?, 12, 20, 0, 0, 0, 0, 0, ?, 1, ?, 'Fornecedor Sprint 2.9', 1)`,
    [produto.id, produto.nome, produto.unidadeComercial, produto.qpe, `INT-${produto.id}`, produto.gtin]
  );
  if (produto.apresentacao) {
    await runDb(
      `INSERT INTO produto_embalagens (
        produto_id, tipo, quantidade, unidade, principal, compra, venda, estoque, ativa
      ) VALUES (?, ?, ?, 'UN', 1, 1, 1, 1, 1)`,
      [produto.id, produto.apresentacao.tipo, produto.apresentacao.quantidade]
    );
  }
}

async function contarSeExistir(tabela) {
  try {
    return Number((await getDb(`SELECT COUNT(*) AS n FROM ${tabela}`)).n);
  } catch (_) {
    return null;
  }
}

/** Estoque, compra, financeiro, cadastro de conversão e documentos: o que uma recusa não pode mudar. */
async function foto(documentoIds = []) {
  const ids = Object.values(PRODUTOS).map((p) => p.id);
  const marcadores = ids.map(() => '?').join(',');
  const financeiro = await getDb('SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total FROM financeiro');
  const documentos = [];
  for (const id of documentoIds) {
    const doc = await getDb('SELECT status, compra_id, parse_json FROM central_entradas_documentos WHERE id = ?', [id]);
    const historico = await getDb('SELECT COUNT(*) AS n FROM central_entradas_historico WHERE documento_id = ?', [id]);
    documentos.push({ id, status: doc.status, compra_id: doc.compra_id, parse: sha(doc.parse_json), historico: Number(historico.n) });
  }
  return {
    produtos: await allDb(
      `SELECT id, unidade, unidade_comercial, quantidade_por_embalagem, estoque_atual, saldo_fiscal, saldo_nao_fiscal
       FROM produtos WHERE id IN (${marcadores}) ORDER BY id`,
      ids
    ),
    apresentacoes: sha(await allDb(
      `SELECT id, produto_id, tipo, quantidade, unidade, tipo_conversao, ativa, compra
       FROM produto_embalagens WHERE produto_id IN (${marcadores}) ORDER BY id`,
      ids
    )),
    compras: Number((await getDb('SELECT COUNT(*) AS n FROM compras')).n),
    itens: Number((await getDb('SELECT COUNT(*) AS n FROM compras_itens')).n),
    lotes: await contarSeExistir('produtos_lotes'),
    financeiro: { n: Number(financeiro.n), total: Number(financeiro.total) },
    documentos
  };
}

const saldo = (f, id) => f.produtos.find((p) => Number(p.id) === id);

async function receber(central, produto, linha, nf, conversoes = []) {
  return receberPelaCentral(central, {
    id: produto.id,
    nf,
    codigo: `S29-${nf}`,
    gtin: produto.gtin,
    nome: produto.nome,
    ...linha
  }, { decisao: 'ASSOCIAR', produtoId: produto.id, conversoes });
}

async function aguardar(condicao, descricao) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > 15000) throw new Error(`Tempo esgotado: ${descricao}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Corpo exato que a tela de Compras envia ao "Confirmar e gravar entrada".
 * O POST /api/compras é interceptado (409) para nada ser gravado; o resto vai às rotas reais.
 */
async function capturarCorpoDaTela(app, recebimento) {
  const appCaptura = express();
  appCaptura.post('/api/compras', (_req, res) => res.status(409).json({ error: 'captura do teste', code: 'CAPTURA_TESTE' }));
  appCaptura.use(app);
  const pagina = criarPaginaCompras(appCaptura);
  pagina.sessao.set('central_abrir_compra', JSON.stringify({
    documentoId: recebimento.documentoId, origem: 'CENTRAL_NFE', dadosCompra: recebimento.dadosCompra
  }));
  pagina.valores.set('input[name="politica_entrada_import"]:checked', 'REVENDA');
  pagina.context.loadCompras();
  await aguardar(
    () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem) || n.tipo === 'danger'),
    'tela carregar a NF-e da Central'
  );
  assert.deepEqual(pagina.notificacoes.filter((n) => n.tipo === 'danger'), []);
  pagina.context.saveCompra();
  await aguardar(() => pagina.requisicoes.some((r) => r.metodo === 'POST' && r.url === '/api/compras'), 'POST da tela');
  const post = pagina.requisicoes.find((r) => r.metodo === 'POST' && r.url === '/api/compras');
  assert.equal(post.resposta.body.code, 'CAPTURA_TESTE');
  assert.equal(post.corpo.itens.length, 1);
  return clonar(post.corpo);
}

const postar = (app, corpo) => request(app).post('/api/compras').send(corpo);

/** Adulteração cuidadosa: fiscal e não fiscal batem com a quantidade convertida inventada. */
function coerenteComFiscal(item, convertida) {
  item.quantidade = convertida;
  item.quantidade_fiscal = convertida;
  item.quantidade_nao_fiscal = 0;
}

async function itensDaCompra(compraId) {
  const itens = await allDb('SELECT produto_id, quantidade FROM compras_itens WHERE compra_id = ? ORDER BY id', [compraId]);
  return itens.map((i) => [Number(i.produto_id), Number(i.quantidade)]);
}

/** Gravação aceita: exatamente 20 UN uma vez; repetir o mesmo corpo não duplica nada. */
async function gravaVinteUmaVez(app, corpo, produto, documentoId, rotulo) {
  const antes = await foto([documentoId]);
  const r = await postar(app, corpo);
  assert.equal(r.status, 200, `${rotulo}: ${JSON.stringify(r.body)}`);
  assert.deepEqual(await itensDaCompra(r.body.id), [[produto.id, 20]], rotulo);
  const depois = await foto([documentoId]);
  assert.equal(Number(saldo(depois, produto.id).saldo_fiscal), Number(saldo(antes, produto.id).saldo_fiscal) + 20, rotulo);
  assert.equal(Number(saldo(depois, produto.id).estoque_atual), Number(saldo(antes, produto.id).estoque_atual) + 20, rotulo);
  assert.equal(depois.compras, antes.compras + 1, rotulo);
  assert.equal(depois.itens, antes.itens + 1, rotulo);
  assert.equal(depois.apresentacoes, antes.apresentacoes, `${rotulo}: cadastro de conversão intacto`);
  const conversao = (f) => f.produtos.map(({ id, unidade, unidade_comercial, quantidade_por_embalagem }) => (
    { id, unidade, unidade_comercial, quantidade_por_embalagem }
  ));
  assert.deepEqual(conversao(depois), conversao(antes), `${rotulo}: cadastro do produto intacto`);

  const repetida = await postar(app, corpo);
  assert.ok(repetida.status >= 400, `${rotulo}: repetição recusada ${JSON.stringify(repetida.body)}`);
  assert.deepEqual(await foto([documentoId]), depois, `${rotulo}: repetição não grava nada`);
  return r.body.id;
}

test('Sprint 2.9 — fator de conversão da NF-e validado pelo backend', async (t) => {
  const { app, central } = await criarCentral();
  for (const produto of Object.values(PRODUTOS)) await cadastrar(produto);
  const apresentacaoOutro = await getDb('SELECT id FROM produto_embalagens WHERE produto_id = ?', [PRODUTOS.outro.id]);
  const apresentacaoPropria = await getDb('SELECT id FROM produto_embalagens WHERE produto_id = ?', [PRODUTOS.apresentacao.id]);
  assert.ok(apresentacaoOutro?.id && apresentacaoPropria?.id);
  let nf = 9901;

  await t.test('exposição: o motor aplica o fator que vier no item; a reconciliação da Central descarta o da tela', () => {
    const linha = {
      uCom: 'PCT', qCom: 5, uTrib: 'PCT', qTrib: 5,
      unidade_comercial: 'PCT', quantidade_comercial: 5, unidade_tributavel: 'PCT', quantidade_tributavel: 5
    };
    const produto = { id: PRODUTOS.semFator.id, unidade: 'UN', unidade_comercial: 'UN', quantidade_por_embalagem: 0 };
    assert.equal(MotorUnidadesMedida.resolverQuantidadeEntradaNfe(linha, produto).codigo, 'FATOR_CONVERSAO_AUSENTE');
    const comFatorDaTela = MotorUnidadesMedida.resolverQuantidadeEntradaNfe({ ...linha, quantidade_por_embalagem: 1200 }, produto);
    assert.equal(comFatorDaTela.ok, true, 'sem a reconciliação, 5 PCT viravam 6000 UN sem pedir confirmação');
    assert.equal(comFatorDaTela.quantidadeEstoque, 6000);

    const adulterado = {
      ...linha,
      central_item_indice: 0,
      nItem: 1,
      produto_id: PRODUTOS.semFator.id,
      quantidade_por_embalagem: 1200,
      fator_conversao: 1200,
      tipo_conversao: 'DIVISOR',
      produto_apresentacao_id: apresentacaoOutro.id,
      embalagem_id: apresentacaoOutro.id,
      quantidade_convertida: 6000,
      quantidade_estoque: 6000
    };
    const r = ConfirmacaoConversaoEntradaNfe.reconciliarItensComDocumentoCentral([adulterado], {
      id: 1,
      itens: [{ nItem: 1, uCom: 'PCT', qCom: 5, uTrib: 'PCT', qTrib: 5 }]
    });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    for (const campo of ConfirmacaoConversaoEntradaNfe.CAMPOS_CONVERSAO_ITEM) {
      assert.equal(r.itens[0][campo], undefined, `${campo} da tela descartado`);
    }
    assert.deepEqual(
      [...r.itens[0].campos_conversao_descartados].sort(),
      ['embalagem_id', 'fator_conversao', 'produto_apresentacao_id', 'quantidade_convertida', 'quantidade_estoque', 'quantidade_por_embalagem', 'tipo_conversao']
    );
  });

  await t.test('sem fator no cadastro: fator ausente, inválido ou adulterado não destrava a linha; nada gravado', async () => {
    const rec = await receber(central, PRODUTOS.semFator, LINHA_PCT_PCT, nf++);
    const corpo = await capturarCorpoDaTela(app, rec);
    const antes = await foto([rec.documentoId]);
    const variantes = [
      ['corpo da tela sem alteração', () => {}],
      ['fator ausente', (i) => { delete i.quantidade_por_embalagem; delete i.fator_conversao; }],
      ['fator texto', (i) => { i.quantidade_por_embalagem = 'abc'; i.fator_conversao = 'abc'; }],
      ['fator negativo', (i) => { i.quantidade_por_embalagem = -4; i.fator_conversao = -4; }],
      ['fator zero', (i) => { i.quantidade_por_embalagem = 0; i.fator_conversao = 0; }],
      ['fator nulo (Infinity no JSON)', (i) => { i.quantidade_por_embalagem = Infinity; i.fator_conversao = null; }],
      ['fator adulterado ×1200', (i) => { i.quantidade_por_embalagem = 1200; i.fator_conversao = 1200; }],
      ['fator ×4 com DIVISOR', (i) => { i.quantidade_por_embalagem = 4; i.tipo_conversao = 'DIVISOR'; }],
      ['apresentação CX×500 de outro produto', (i) => {
        i.produto_apresentacao_id = apresentacaoOutro.id; i.embalagem_id = apresentacaoOutro.id;
      }],
      ['quantidade convertida pela tela (coerente com o fiscal)', (i) => {
        i.quantidade_por_embalagem = 4; i.quantidade_convertida = 20; i.quantidade_estoque = 20; i.conversao_aplicada = true;
        coerenteComFiscal(i, 20);
      }]
    ];
    for (const [rotulo, alterar] of variantes) {
      const adulterado = clonar(corpo);
      alterar(adulterado.itens[0]);
      const r = await postar(app, adulterado);
      assert.equal(r.status, 422, `${rotulo}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'PENDENCIAS_CONVERSAO', rotulo);
      assert.equal(r.body.pendencias.length, 1, rotulo);
      assert.equal(r.body.pendencias[0].codigo, 'FATOR_CONVERSAO_AUSENTE', rotulo);
      assert.equal(r.body.pendencias[0].bloqueia_efetivacao, true, rotulo);
      assert.equal(Number(r.body.pendencias[0].fatorConversao), 0, `${rotulo}: nenhum fator da tela aceito`);
    }

    // Corpo incoerente (fiscal ≠ convertida da tela) já é recusado na validação de entrada, antes da Central.
    const incoerente = clonar(corpo);
    Object.assign(incoerente.itens[0], { quantidade_por_embalagem: 1200, quantidade_convertida: 6000, quantidade_fiscal: 5 });
    const r = await postar(app, incoerente);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.error, /deve somar 6000/);
    assert.deepEqual(await foto([rec.documentoId]), antes);
  });

  await t.test('apresentação cadastrada ×4: válida pela tela grava 20 uma vez', async () => {
    const rec = await receber(central, PRODUTOS.apresentacao, LINHA_PCT_PCT, nf++);
    const antes = await foto([rec.documentoId]);
    const tela = await lancarCompraPelaTela(app, rec);
    assert.equal(tela.gravacao.resposta.status, 200, JSON.stringify(tela.gravacao.resposta.body));
    assert.deepEqual(await itensDaCompra(tela.gravacao.resposta.body.id), [[PRODUTOS.apresentacao.id, 20]]);
    const depois = await foto([rec.documentoId]);
    assert.equal(Number(saldo(depois, PRODUTOS.apresentacao.id).saldo_fiscal), Number(saldo(antes, PRODUTOS.apresentacao.id).saldo_fiscal) + 20);
    assert.equal(depois.compras, antes.compras + 1);
    const repetida = await postar(app, tela.gravacao.corpo);
    assert.ok(repetida.status >= 400, JSON.stringify(repetida.body));
    assert.deepEqual(await foto([rec.documentoId]), depois);
  });

  await t.test('apresentação cadastrada ×4: fator adulterado, divergente, inválido, de outro produto ou já convertido → grava 20', async () => {
    const variantes = [
      ['fator adulterado ×1200', (i) => { i.quantidade_por_embalagem = 1200; i.fator_conversao = 1200; }],
      ['fator divergente do cadastro (×6)', (i) => { i.quantidade_por_embalagem = 6; i.fator_conversao = 6; }],
      ['fator inválido', (i) => { i.quantidade_por_embalagem = 'abc'; i.fator_conversao = -4; }],
      ['fator ausente', (i) => { delete i.quantidade_por_embalagem; delete i.fator_conversao; }],
      ['apresentação CX×500 de outro produto com DIVISOR', (i) => {
        i.produto_apresentacao_id = apresentacaoOutro.id; i.embalagem_id = apresentacaoOutro.id; i.tipo_conversao = 'DIVISOR';
      }],
      ['dupla conversão (quantidade já convertida pela tela)', (i) => {
        i.quantidade_comercial = 20; i.qCom = 20; i.quantidade_embalagens = 20;
        i.quantidade_convertida = 80; i.quantidade_estoque = 80; i.conversao_aplicada = true;
        coerenteComFiscal(i, 80);
      }]
    ];
    for (const [rotulo, alterar] of variantes) {
      const rec = await receber(central, PRODUTOS.apresentacao, LINHA_PCT_PCT, nf++);
      const corpo = await capturarCorpoDaTela(app, rec);
      alterar(corpo.itens[0]);
      await gravaVinteUmaVez(app, corpo, PRODUTOS.apresentacao, rec.documentoId, rotulo);
    }
  });

  await t.test('fator do cadastro do produto (PCT×4 legado): válido pela tela e com fator divergente da tela → grava 20', async () => {
    const valido = await receber(central, PRODUTOS.legado, LINHA_PCT_UN, nf++);
    const tela = await lancarCompraPelaTela(app, valido);
    assert.equal(tela.gravacao.resposta.status, 200, JSON.stringify(tela.gravacao.resposta.body));
    assert.deepEqual(await itensDaCompra(tela.gravacao.resposta.body.id), [[PRODUTOS.legado.id, 20]]);

    const rec = await receber(central, PRODUTOS.legado, LINHA_PCT_UN, nf++);
    const corpo = await capturarCorpoDaTela(app, rec);
    corpo.itens[0].quantidade_por_embalagem = 6;
    corpo.itens[0].fator_conversao = 6;
    await gravaVinteUmaVez(app, corpo, PRODUTOS.legado, rec.documentoId, 'fator da tela ×6 contra cadastro ×4');
  });

  await t.test('linha confirmada na Central (qTrib 20 UN): fator e quantidade confirmada da tela não mudam os 20', async () => {
    const rec = await receber(central, PRODUTOS.qtrib, LINHA_PCT_UN, nf++, [{ indice: 0, decisao: 'SIM' }]);
    assert.equal(rec.conversoes[0].confirmada, true, JSON.stringify(rec.conversoes[0]));
    const corpo = await capturarCorpoDaTela(app, rec);
    Object.assign(corpo.itens[0], {
      quantidade_por_embalagem: 1200,
      fator_conversao: 1200,
      quantidade_convertida: 6000,
      quantidade_estoque_confirmada: 6000,
      conversao_decisao: 'SIM',
      decisao_conversao: true
    });
    coerenteComFiscal(corpo.itens[0], 6000);
    await gravaVinteUmaVez(app, corpo, PRODUTOS.qtrib, rec.documentoId, 'confirmada + tela adulterada');
  });

  await t.test('conversão efetiva diferente da validada: 422, nada gravado; corrigido o cálculo, grava 20 uma vez', async () => {
    const rec = await receber(central, PRODUTOS.apresentacao, LINHA_PCT_PCT, nf++);
    const corpo = await capturarCorpoDaTela(app, rec);
    const muc = obterMuc(db);
    const original = muc.processarItemCompra;
    muc.processarItemCompra = function processarDobrando(...args) {
      const callback = args.pop();
      return original.call(this, ...args, (err, resultado) => (
        err ? callback(err) : callback(null, { ...resultado, quantidadeEstoque: Number(resultado.quantidadeEstoque) * 2 })
      ));
    };
    const antes = await foto([rec.documentoId]);
    let r;
    try {
      r = await postar(app, corpo);
    } finally {
      muc.processarItemCompra = original;
    }
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, 'CONVERSAO_EFETIVA_DIVERGENTE', JSON.stringify(r.body));
    assert.deepEqual(await foto([rec.documentoId]), antes, 'rollback completo');

    await gravaVinteUmaVez(app, corpo, PRODUTOS.apresentacao, rec.documentoId, 'depois da recusa');
  });
});
