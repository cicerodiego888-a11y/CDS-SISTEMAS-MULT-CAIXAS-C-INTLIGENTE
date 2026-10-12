'use strict';

/**
 * Sprint 3.4 — produtos criados por Compras e pela Importação Inicial precisam:
 * gravar nome_busca no INSERT, ser publicados (cache MIP do PDV + MIB) depois do COMMIT
 * e aparecer na pesquisa imediatamente, sem reiniciar, mesmo com outros itens no resultado.
 * Rotas reais sobre banco SQLite temporário (DB_DIR isolado).
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s34-'));
process.env.DB_DIR = dbDir;
delete require.cache[require.resolve('../../backend/database')];
const db = require('../../backend/database');
const { obterMib, normalizarNomeBusca } = require('../../backend/motores/mib');
const importacaoSvc = require('../../backend/services/importacao-inicial-produtos');

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) { return err ? reject(err) : resolve(this); });
  });
}
function getDb(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
}
function allDb(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

function ean13(base12) {
  const soma = base12.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (soma % 10)) % 10}`;
}

function criarApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/produtos/importacao-inicial', require('../../backend/rotas/importacao-inicial-produtos'));
  app.use('/api/compras', require('../../backend/rotas/compras'));
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  return app;
}

/** Captura os INSERT INTO produtos executados durante `fn` (prova de gravação no INSERT, sem backfill). */
async function capturarInsertsProdutos(fn) {
  const original = db.run;
  const inserts = [];
  db.run = function espiao(sql, ...resto) {
    if (/INSERT\s+INTO\s+produtos\s*\(/i.test(String(sql))) inserts.push({ sql: String(sql), params: resto[0] });
    return original.call(this, sql, ...resto);
  };
  try {
    const resultado = await fn();
    return { resultado, inserts };
  } finally {
    db.run = original;
  }
}

/** Espiona o MIB real (singleton do banco em uso); `falhar` simula indisponibilidade. */
function espionarMib(metodo, { falhar = false } = {}) {
  const mib = obterMib(db);
  const original = mib[metodo];
  const chamadas = [];
  mib[metodo] = function espiao(arg) {
    chamadas.push(arg);
    if (falhar) throw new Error('MIB indisponível (simulado)');
    return original.call(this, arg);
  };
  return { chamadas, restaurar: () => { mib[metodo] = original; } };
}

async function buscar(app, termo) {
  const r = await request(app).get('/api/produtos/busca-operacional').query({ q: termo, sugestoes: '0' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.itens || [];
}

async function identificarPdv(app, codigo) {
  const r = await request(app).get('/api/produtos/identificar').query({ codigo });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

async function semearConcorrente(nome, codigo) {
  const ins = await runDb(
    `INSERT INTO produtos (codigo, nome, nome_busca, ativo, unidade, preco_compra, preco_venda,
       estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque)
     VALUES (?, ?, ?, 1, 'UN', 5, 10, 3, 3, 0, 1, 1)`,
    [codigo, nome, normalizarNomeBusca(nome)]
  );
  return ins.lastID;
}

function corpoCompraManual(item, extra = {}) {
  const subtotal = Number(item.quantidade) * Number(item.preco_unitario);
  return {
    data_compra: '2026-10-09',
    fornecedor: 'Fornecedor Sprint 3.4',
    total: subtotal,
    valor_total_nota: subtotal,
    condicao_pagamento: 'avista',
    forma_pagamento: 'dinheiro',
    tipo_entrada: 'REVENDA',
    origem_compra: 'MANUAL',
    itens: [{ unidade: 'UN', quantidade_nao_fiscal: 0, subtotal, ...item }],
    ...extra
  };
}

let app;

before(async () => {
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  app = criarApp();
  await semearConcorrente('ARROZ TIO JOAO 5KG', 'S34-CONC-1');
  await semearConcorrente('ARROZ CAMIL 1KG', 'S34-CONC-2');
  await semearConcorrente('ARROZ PARBOILIZADO PRATO FINO 1KG', 'S34-CONC-3');
  await semearConcorrente('FEIJAO CARIOCA KICALDO 1KG', 'S34-CONC-4');
  await semearConcorrente('FEIJAO PRETO CAMIL 1KG', 'S34-CONC-5');
});

describe('Sprint 3.4 — Correção A: produto criado automaticamente pela Compra', () => {
  const NOME = 'ARROZ SPRINT34 COMPRA PREMIUM 5KG';
  const EAN = ean13('789340000001');
  const PLU = '834';
  let produtoId;
  let mibCriado;

  it('antes da compra: produto inexistente e PDV (MIP) registra o lookup negativo em cache', async () => {
    assert.equal(await getDb('SELECT id FROM produtos WHERE codigo_barras = ?', [EAN]), undefined);
    const pdv = await identificarPdv(app, EAN);
    assert.equal(pdv.encontrado, false);
  });

  it('POST /api/compras cria o produto com nome_busca e ativo no próprio INSERT e publica após o COMMIT', async () => {
    mibCriado = espionarMib('notificarProdutoCriado');
    try {
      const { resultado: r, inserts } = await capturarInsertsProdutos(() => request(app)
        .post('/api/compras')
        .send(corpoCompraManual({
          produto_nome: NOME, codigo_barras: EAN, plu: PLU,
          quantidade: 5, quantidade_fiscal: 5, preco_unitario: 10
        })));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.aviso, undefined, 'publicação OK não gera aviso');

      assert.equal(inserts.length, 1, 'um único INSERT de produto');
      assert.match(inserts[0].sql, /nome_busca/);
      assert.ok(inserts[0].params.includes(normalizarNomeBusca(NOME)), 'nome_busca gravado no INSERT (sem backfill)');

      const produto = await getDb('SELECT * FROM produtos WHERE codigo_barras = ?', [EAN]);
      produtoId = produto.id;
      assert.equal(produto.nome, NOME, 'nome original preservado');
      assert.equal(produto.nome_busca, normalizarNomeBusca(NOME));
      assert.equal(Number(produto.ativo), 1);

      assert.deepEqual(r.body.catalogoOperacional, { produtos_criados: [produtoId], publicados: 1, falhas: [] });
      assert.equal(mibCriado.chamadas.length, 1, 'MIB recebe a publicação uma vez');
      assert.equal(Number(mibCriado.chamadas[0].id), produtoId);
      assert.equal(mibCriado.chamadas[0].nome_busca, normalizarNomeBusca(NOME));
      assert.equal(String(mibCriado.chamadas[0].plu), PLU);
    } finally {
      mibCriado.restaurar();
    }
  });

  it('pesquisa imediata (sem reiniciar): nome completo, prefixo, trecho, código interno, EAN e PLU', async () => {
    for (const termo of [NOME, 'ARROZ SPRINT34', 'arroz sprint34 compra', 'PREMIUM', EAN, PLU]) {
      const ids = (await buscar(app, termo)).map((p) => Number(p.id));
      assert.ok(ids.includes(produtoId), `"${termo}" deve encontrar o produto novo; veio ${JSON.stringify(ids)}`);
    }
  });

  it('termo com concorrentes: o servidor devolve outros itens e o produto novo está entre eles', async () => {
    const itens = await buscar(app, 'arroz');
    const ids = itens.map((p) => Number(p.id));
    assert.ok(itens.length >= 4, `esperava concorrentes + novo; veio ${itens.map((p) => p.nome).join(' | ')}`);
    assert.ok(ids.includes(produtoId), 'produto novo presente mesmo com outros resultados');
  });

  it('cache MIP do PDV invalidado: EAN e PLU identificados logo após a compra', async () => {
    const porEan = await identificarPdv(app, EAN);
    assert.equal(porEan.encontrado, true, JSON.stringify(porEan));
    assert.equal(Number(porEan.produtoId ?? porEan.produto?.id), produtoId);
    const porPlu = await identificarPdv(app, PLU);
    assert.equal(porPlu.encontrado, true, JSON.stringify(porPlu));
    assert.equal(Number(porPlu.produtoId ?? porPlu.produto?.id), produtoId);
  });

  it('cadastro único com saldo fiscal e não fiscal na mesma linha', async () => {
    const linhas = await allDb('SELECT id, saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE codigo_barras = ?', [EAN]);
    assert.equal(linhas.length, 1);
    assert.equal(Number(linhas[0].saldo_fiscal), 5);
    assert.equal(Number(linhas[0].saldo_nao_fiscal), 0);
    assert.equal(Number(linhas[0].estoque_atual), 5);
  });

  it('nova compra do mesmo item não duplica o cadastro nem republica', async () => {
    const espiao = espionarMib('notificarProdutoCriado');
    try {
      const r = await request(app).post('/api/compras').send(corpoCompraManual({
        produto_nome: NOME, codigo_barras: EAN, quantidade: 2, quantidade_fiscal: 2, preco_unitario: 10
      }));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.catalogoOperacional, undefined, 'nenhum produto criado');
      assert.equal(espiao.chamadas.length, 0);
      const linhas = await allDb('SELECT id, saldo_fiscal FROM produtos WHERE codigo_barras = ?', [EAN]);
      assert.equal(linhas.length, 1, 'continua um único cadastro');
      assert.equal(Number(linhas[0].saldo_fiscal), 7);
      const item = await getDb('SELECT produto_id FROM compras_itens WHERE compra_id = ?', [r.body.id]);
      assert.equal(Number(item.produto_id), produtoId);
    } finally {
      espiao.restaurar();
    }
  });

  it('compra desfeita (ROLLBACK) não deixa produto nem publica; nova tentativa cria um só', async () => {
    const NOME_RB = 'ARROZ SPRINT34 ROLLBACK 2KG';
    const EAN_RB = ean13('789340000002');
    const espiao = espionarMib('notificarProdutoCriado');
    try {
      const corpo = corpoCompraManual({
        produto_nome: NOME_RB, codigo_barras: EAN_RB, quantidade: 1, quantidade_fiscal: 1, preco_unitario: 10
      });
      corpo.itens.push({ ...corpo.itens[0], produto_nome: 'ITEM INVALIDO', codigo_barras: null, produto_id: 99999999 });
      corpo.total = corpo.valor_total_nota = 20;
      const falha = await request(app).post('/api/compras').send(corpo);
      assert.ok(falha.status >= 400, `compra precisa falhar: ${falha.status} ${JSON.stringify(falha.body)}`);
      assert.equal(await getDb('SELECT id FROM produtos WHERE codigo_barras = ?', [EAN_RB]), undefined, 'ROLLBACK remove o produto');
      assert.equal(espiao.chamadas.length, 0, 'nada publicado sem COMMIT');

      const ok = await request(app).post('/api/compras').send(corpoCompraManual({
        produto_nome: NOME_RB, codigo_barras: EAN_RB, quantidade: 1, quantidade_fiscal: 1, preco_unitario: 10
      }));
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const linhas = await allDb('SELECT id FROM produtos WHERE codigo_barras = ?', [EAN_RB]);
      assert.equal(linhas.length, 1);
      assert.equal(espiao.chamadas.length, 1);
      assert.ok((await buscar(app, NOME_RB)).some((p) => Number(p.id) === Number(linhas[0].id)));
    } finally {
      espiao.restaurar();
    }
  });

  it('falha de publicação no MIB: compra gravada, resposta com aviso (sem sucesso enganoso), produto pesquisável', async () => {
    const NOME_F = 'ARROZ SPRINT34 FALHA MIB 1KG';
    const EAN_F = ean13('789340000003');
    const espiao = espionarMib('notificarProdutoCriado', { falhar: true });
    try {
      const r = await request(app).post('/api/compras').send(corpoCompraManual({
        produto_nome: NOME_F, codigo_barras: EAN_F, quantidade: 1, quantidade_fiscal: 1, preco_unitario: 10
      }));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.match(String(r.body.aviso || ''), /não foi publicado no catálogo de pesquisa/);
      assert.equal(r.body.catalogoOperacional.publicados, 0);
      assert.equal(r.body.catalogoOperacional.falhas.length, 1);
      assert.match(r.body.catalogoOperacional.falhas[0].erros.join(' '), /MIB indisponível/);
      const produto = await getDb('SELECT id, nome_busca FROM produtos WHERE codigo_barras = ?', [EAN_F]);
      assert.equal(produto.nome_busca, normalizarNomeBusca(NOME_F));
      assert.ok((await buscar(app, 'ARROZ SPRINT34 FALHA')).some((p) => Number(p.id) === Number(produto.id)),
        'busca operacional não depende do MIB');
    } finally {
      espiao.restaurar();
    }
  });
});

describe('Sprint 3.4 — Correção B: produto criado pela Importação Inicial', () => {
  const NOME = 'FEIJAO SPRINT34 IMPORTADO 1KG';
  const MARCA = 'MARCA S34 IMPORT';
  const CODIGO = 'S34-IMP-01';
  const EAN = ean13('789340000011');
  let produtoId;

  function linhaPlanilha(codigo, nome, ean, marca = MARCA) {
    return {
      'Código origem': codigo,
      'Nome CDS': nome,
      Marca: marca,
      Categoria: '',
      Subcategoria: '',
      'Unidade base': 'UN',
      'Unidade origem': 'UN',
      'Qtd documento': 4,
      'Custo unitário': 6,
      'Markup %': 100,
      Fiscal: 'SIM',
      'Preço venda unitário': 12,
      EAN: ean
    };
  }

  async function validarPelaRota(nomeArquivo, linhas) {
    const buffer = importacaoSvc.gerarXlsxFixture({ produtos: linhas });
    const r = await request(app)
      .post('/api/produtos/importacao-inicial/validar')
      .field('modo', 'CADASTRO_INICIAL')
      .field('modo_fiscal_importacao', 'FISCAL')
      .attach('arquivo', buffer, nomeArquivo);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 800));
    return r.body;
  }

  async function importarPelaRota(sessaoId) {
    return request(app)
      .post('/api/produtos/importacao-inicial/importar')
      .send({ sessao_id: sessaoId, politica_pendentes: 'IMPORTAR_SEM_CLASSIFICACAO' });
  }

  it('antes da importação: PDV (MIP) registra lookup negativo do EAN', async () => {
    assert.equal((await identificarPdv(app, EAN)).encontrado, false);
  });

  it('importação grava nome_busca no INSERT e publica o lote uma única vez após o COMMIT', async () => {
    const validacao = await validarPelaRota('s34-importacao.xlsx', [linhaPlanilha(CODIGO, NOME, EAN)]);
    assert.equal(validacao.pode_importar, true, JSON.stringify(validacao.linhas?.[0]).slice(0, 600));
    const mibImportado = espionarMib('notificarProdutoImportado');
    const mibCriado = espionarMib('notificarProdutoCriado');
    try {
      const { resultado: r, inserts } = await capturarInsertsProdutos(() => importarPelaRota(validacao.sessao_id));
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 800));
      assert.equal(r.body.aviso, undefined);
      assert.equal(r.body.relatorio.criados, 1);
      assert.equal(inserts.length, 1);
      assert.match(inserts[0].sql, /nome_busca/);
      assert.ok(inserts[0].params.includes(normalizarNomeBusca(NOME)), 'nome_busca gravado no INSERT (sem backfill)');

      produtoId = Number(r.body.relatorio.ids_criados[0]);
      const produto = await getDb('SELECT * FROM produtos WHERE id = ?', [produtoId]);
      assert.equal(produto.nome, NOME);
      assert.equal(produto.nome_busca, normalizarNomeBusca(NOME));
      assert.notEqual(Number(produto.ativo), 0, 'ativação preservada (padrão do schema)');

      assert.equal(r.body.catalogo_operacional.status, 'PUBLICADO');
      assert.equal(mibImportado.chamadas.length, 1, 'uma notificação consolidada por lote');
      assert.deepEqual(mibImportado.chamadas[0].ids_criados.map(Number), [produtoId]);
      assert.equal(mibCriado.chamadas.length, 0, 'sem evento por produto no lote');
    } finally {
      mibImportado.restaurar();
      mibCriado.restaurar();
    }
  });

  it('pesquisa imediata: nome completo, prefixo, trecho, marca, código interno e EAN', async () => {
    for (const termo of [NOME, 'FEIJAO SPRINT34', 'feijao sprint34 imp', 'IMPORTADO', MARCA, CODIGO, EAN]) {
      const ids = (await buscar(app, termo)).map((p) => Number(p.id));
      assert.ok(ids.includes(produtoId), `"${termo}" deve encontrar o produto importado; veio ${JSON.stringify(ids)}`);
    }
  });

  it('termo com concorrentes: produto importado aparece junto dos demais', async () => {
    const itens = await buscar(app, 'feijao');
    assert.ok(itens.length >= 3, itens.map((p) => p.nome).join(' | '));
    assert.ok(itens.some((p) => Number(p.id) === produtoId));
  });

  it('cache MIP do PDV invalidado: EAN identificado logo após a importação', async () => {
    const pdv = await identificarPdv(app, EAN);
    assert.equal(pdv.encontrado, true, JSON.stringify(pdv));
    assert.equal(Number(pdv.produtoId ?? pdv.produto?.id), produtoId);
  });

  it('cadastro único com os dois saldos na mesma linha', async () => {
    const linhas = await allDb('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE codigo = ?', [CODIGO]);
    assert.equal(linhas.length, 1);
    assert.equal(Number(linhas[0].saldo_fiscal) + Number(linhas[0].saldo_nao_fiscal), Number(linhas[0].estoque_atual));
  });

  it('nova tentativa não duplica: mesma sessão é idempotente e a mesma planilha vira EXISTENTE', async () => {
    const validacao = await validarPelaRota('s34-importacao-repetida.xlsx', [linhaPlanilha(CODIGO, NOME, EAN)]);
    assert.notEqual(validacao.linhas[0].status, 'PRONTO', 'produto já cadastrado não é criado de novo');
    const r = await importarPelaRota(validacao.sessao_id);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 600));
    assert.equal(r.body.relatorio.criados, 0);
    const repetida = await importarPelaRota(validacao.sessao_id);
    assert.equal(repetida.body.ja_importado, true);
    const linhas = await allDb('SELECT id FROM produtos WHERE codigo = ? OR codigo_barras = ?', [CODIGO, EAN]);
    assert.equal(linhas.length, 1);
  });

  it('falha de publicação: importação gravada, resposta com aviso e status FALHA, produto pesquisável', async () => {
    const NOME_F = 'FEIJAO SPRINT34 FALHA IMPORT 2KG';
    const validacao = await validarPelaRota('s34-importacao-falha.xlsx', [
      linhaPlanilha('S34-IMP-02', NOME_F, ean13('789340000012'))
    ]);
    const espiao = espionarMib('notificarProdutoImportado', { falhar: true });
    try {
      const r = await importarPelaRota(validacao.sessao_id);
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 600));
      assert.equal(r.body.relatorio.criados, 1);
      assert.equal(r.body.catalogo_operacional.status, 'FALHA');
      assert.match(r.body.catalogo_operacional.erros.join(' '), /MIB indisponível/);
      assert.match(String(r.body.aviso || ''), /publicação no catálogo de pesquisa \(MIB\/PDV\) falhou/);
      const id = Number(r.body.relatorio.ids_criados[0]);
      assert.ok((await buscar(app, 'FEIJAO SPRINT34 FALHA')).some((p) => Number(p.id) === id));
    } finally {
      espiao.restaurar();
    }
  });
});
