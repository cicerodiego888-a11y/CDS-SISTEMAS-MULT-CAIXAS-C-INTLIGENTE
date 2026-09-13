'use strict';

/**
 * MIB-RC3.0 — Enterprise Search Platform
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  MIB_VERSION,
  MIB_CODIGO,
  normalizarNomeBusca,
  MibService,
  SearchService,
  SearchSDK,
  EVENTOS,
  obterSearchService
} = require('../../backend/motores/mib');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib30-'));
    const arquivo = path.join(dir, 'test.db');
    const db = new sqlite3.Database(arquivo, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT UNIQUE,
          codigo_barras TEXT,
          nome TEXT NOT NULL,
          nome_busca TEXT,
          ncm TEXT,
          cfop TEXT,
          preco_venda REAL DEFAULT 0,
          ativo INTEGER DEFAULT 1,
          item_fiscal INTEGER DEFAULT 1,
          categoria_id INTEGER,
          marca_id INTEGER,
          unidade TEXT,
          unidade_comercial TEXT DEFAULT 'UN',
          quantidade_por_embalagem REAL DEFAULT 0,
          compra_por_embalagem INTEGER DEFAULT 0,
          valor_compra_embalagem REAL DEFAULT 0,
          estoque_atual REAL DEFAULT 0,
          saldo_fiscal REAL DEFAULT 0,
          saldo_nao_fiscal REAL DEFAULT 0,
          controla_estoque INTEGER DEFAULT 1,
          estoque_minimo REAL DEFAULT 0,
          vendido_por_peso INTEGER DEFAULT 0,
          produto_fracionado INTEGER DEFAULT 0,
          permite_venda_unidade INTEGER DEFAULT 0,
          peso_medio_unidade REAL DEFAULT 0,
          preco_unidade REAL DEFAULT 0,
          preco_compra REAL DEFAULT 0
        )`);
        db.run(`CREATE TABLE produto_identificadores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id INTEGER, tipo TEXT, codigo TEXT,
          ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1)`);
        db.run(`CREATE TABLE clientes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT, cpf_cnpj TEXT, telefone TEXT, email TEXT, cidade TEXT, uf TEXT
        )`);
        db.run(`CREATE TABLE fornecedores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT, razao_social TEXT, cpf_cnpj TEXT, telefone TEXT, email TEXT, contato TEXT, cidade TEXT, uf TEXT
        )`);
        db.run(`CREATE TABLE usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT, password_hash TEXT, role TEXT DEFAULT 'operador'
        )`);
        db.run(`CREATE TABLE contas_receber (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id INTEGER, numero_parcela INTEGER, valor_parcela REAL,
          valor_restante REAL, status TEXT, data_vencimento TEXT
        )`);
        db.run(`CREATE TABLE promocoes (
          id INTEGER PRIMARY KEY, produto_id INTEGER, status TEXT,
          data_inicio TEXT, data_fim TEXT, preco_promocional REAL, desconto_percentual REAL
        )`);
        db.run(`CREATE TABLE produto_atacado (
          id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL
        )`);
        db.run(`CREATE TABLE vendas (id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0)`);
        db.run(`CREATE TABLE vendas_itens (
          id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL
        )`);
        db.run(`INSERT INTO categorias (id, nome) VALUES (1, 'Bebidas')`);
        db.run(`INSERT INTO marcas (id, nome) VALUES (1, 'Coca Cola')`);
        db.run(`INSERT INTO clientes (nome, cpf_cnpj, telefone, cidade, uf)
                VALUES ('Maria Silva', '12345678901', '11999999999', 'São Paulo', 'SP')`);
        db.run(`INSERT INTO fornecedores (nome, razao_social, cpf_cnpj)
                VALUES ('Distribuidora ABC', 'ABC LTDA', '11222333000199')`);
        db.run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('joao', 'x', 'operador')`);
        db.run(
          `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, ncm, cfop, preco_venda)
           VALUES ('10', '7891', 'Coca Cola 2L', ?, '22021000', '5102', 8.5)`,
          [normalizarNomeBusca('Coca Cola 2L')],
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

async function main() {
  await test('versão >= RC3.0', () => {
    assert.ok(MIB_VERSION);
    assert.ok(String(MIB_CODIGO).startsWith('MIB-RC'));
  });

  await test('eventos Search* existem', () => {
    assert.ok(EVENTOS.SearchStarted);
    assert.ok(EVENTOS.SearchCompleted);
    assert.ok(EVENTOS.SearchCacheHit);
    assert.ok(EVENTOS.SearchFailure);
  });

  const db = await criarDb();
  MibService.resetInstance();
  SearchService.resetInstance();

  const mib = MibService.getInstance(db);
  await mib.iniciar();
  const search = obterSearchService(db);
  await search.iniciar();

  await test('providers registrados', () => {
    const lista = search.listarProviders();
    assert.ok(lista.some((p) => p.entity === 'produto'));
    assert.ok(lista.some((p) => p.entity === 'cliente'));
    assert.ok(lista.some((p) => p.entity === 'fornecedor'));
    assert.ok(lista.length >= 6);
  });

  await test('SearchService produto', async () => {
    const r = await search.search({
      entity: 'produto',
      query: 'coca',
      limite: 10,
      skipAuth: true,
      origem: 'test'
    });
    assert.ok(r.itens.some((p) => /coca/i.test(p.nome)));
    assert.ok((r.meta.tempoMs || 0) < 50);
  });

  await test('SearchService cliente', async () => {
    const r = await search.search({
      entity: 'cliente',
      query: 'Maria',
      limite: 10,
      skipAuth: true
    });
    assert.ok(r.itens.some((c) => /maria/i.test(c.nome)));
  });

  await test('SearchService fornecedor', async () => {
    const r = await search.search({
      entity: 'fornecedor',
      query: 'ABC',
      limite: 10,
      skipAuth: true
    });
    assert.ok(r.itens.length >= 1);
  });

  await test('SearchService fiscal NCM', async () => {
    const r = await search.search({
      entity: 'ncm',
      query: '2202',
      limite: 10,
      skipAuth: true
    });
    assert.ok(r.itens.some((i) => String(i.codigo).includes('2202')));
  });

  await test('cache hit segunda busca', async () => {
    const hitsAntes = search.cache.hits || 0;
    const r1 = await search.search({
      entity: 'cliente',
      query: 'Silva',
      limite: 15,
      skipAuth: true
    });
    assert.ok(r1.itens.length >= 1);
    const r2 = await search.search({
      entity: 'cliente',
      query: 'Silva',
      limite: 15,
      skipAuth: true
    });
    assert.strictEqual(r2.meta.fonte, 'cache');
    assert.ok(search.cache.hits > hitsAntes);
  });

  await test('permissão nega sem auth', async () => {
    let negou = false;
    try {
      await search.search({
        entity: 'usuario',
        query: 'joao',
        role: 'operador',
        permissoes: [],
        skipAuth: false
      });
    } catch (e) {
      negou = e.code === 'SEARCH_FORBIDDEN';
    }
    assert.ok(negou);
  });

  await test('SearchSDK API', async () => {
    const sdk = SearchSDK.fromDb(db);
    const r = await sdk.search({ entity: 'categoria', query: 'Bebidas', skipAuth: true });
    assert.ok(r.itens.some((c) => /bebida/i.test(c.nome)));
    const stats = sdk.statistics();
    assert.ok(stats.providersAtivos >= 1);
  });

  await test('IndexManager + telemetry', async () => {
    const diag = await search.indexManager.diagnosticar();
    assert.ok(diag.ok);
    const dash = await search.enterpriseDashboard();
    assert.ok(dash.providersAtivos >= 1);
    assert.ok(typeof dash.tempoMedio === 'number');
  });

  await test('AutoBenchmark entidades', async () => {
    const b = await search.benchmark.executar(['produto', 'cliente', 'fornecedor']);
    assert.ok(b.resultados.length >= 3);
    assert.ok(b.resultados.every((x) => x.amostras >= 0));
  });

  await test('observer SearchCompleted', async () => {
    let hit = false;
    search.on(EVENTOS.SearchCompleted, () => { hit = true; });
    await search.search({ entity: 'marca', query: 'Coca', skipAuth: true });
    assert.ok(hit);
  });

  SearchService.resetInstance();
  MibService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });
  console.log('\nMIB-RC3.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
