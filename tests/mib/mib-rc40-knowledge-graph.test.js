'use strict';

/**
 * MIB-RC4.0 — Knowledge Graph & Product Intelligence
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
  KnowledgeService,
  SimilarityEngine,
  ClusterEngine,
  DuplicateDetector,
  aplicarContexto,
  REL,
  SearchService,
  MibService
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib40-'));
    const db = new sqlite3.Database(path.join(dir, 'test.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT, codigo_barras TEXT, nome TEXT NOT NULL, nome_busca TEXT,
          preco_venda REAL DEFAULT 0, ativo INTEGER DEFAULT 1, item_fiscal INTEGER DEFAULT 1,
          categoria_id INTEGER, marca_id INTEGER, ncm TEXT, cfop TEXT, cest TEXT,
          fornecedor_id INTEGER
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1)`);
        db.run(`CREATE TABLE fornecedores (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0, filial_id INTEGER
        )`);
        db.run(`CREATE TABLE vendas_itens (
          id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL
        )`);
        db.run(`CREATE TABLE produto_identificadores (
          id INTEGER PRIMARY KEY, produto_id INTEGER, tipo TEXT, codigo TEXT,
          ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE promocoes (
          id INTEGER PRIMARY KEY, produto_id INTEGER, status TEXT,
          data_inicio TEXT, data_fim TEXT, preco_promocional REAL, desconto_percentual REAL
        )`);
        db.run(`CREATE TABLE produto_atacado (
          id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL
        )`);
        db.run(`INSERT INTO categorias (id, nome) VALUES (1, 'Bebidas'), (2, 'Descartáveis')`);
        db.run(`INSERT INTO marcas (id, nome) VALUES (1, 'Coca Cola'), (2, 'Generica')`);
        db.run(
          `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, preco_venda, categoria_id, marca_id, ncm)
           VALUES
           ('10', '7891000100010', 'Coca Cola 2L', ?, 8.5, 1, 1, '22021000'),
           ('11', '7891000100027', 'Coca Cola Lata 350ml', ?, 3.5, 1, 1, '22021000'),
           ('20', '7892000200010', 'Gelo 5kg', ?, 10, 2, 2, '22019000'),
           ('21', '7892000200027', 'Copo Descartável', ?, 5, 2, 2, '39241000'),
           ('30', '7891000100010', 'Coca Cola 2 Litros DUP', ?, 8.9, 1, 1, '22021000')`,
          [
            normalizarNomeBusca('Coca Cola 2L'),
            normalizarNomeBusca('Coca Cola Lata 350ml'),
            normalizarNomeBusca('Gelo 5kg'),
            normalizarNomeBusca('Copo Descartável'),
            normalizarNomeBusca('Coca Cola 2 Litros DUP')
          ]
        );
        db.run(`INSERT INTO vendas (id, data_venda, cancelada) VALUES (1, datetime('now'), 0)`);
        db.run(
          `INSERT INTO vendas_itens (venda_id, produto_id, quantidade) VALUES
           (1, 1, 1), (1, 3, 1), (1, 4, 1)`,
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

async function main() {
  await test('versão RC4.0', () => {
    assert.strictEqual(MIB_VERSION, '4.0.0');
    assert.strictEqual(MIB_CODIGO, 'MIB-RC4.0');
  });

  await test('SimilarityEngine score', () => {
    const sim = new SimilarityEngine();
    const a = { id: 1, nome: 'Coca Cola 2L', categoria_id: 1, marca_id: 1, preco_venda: 8, ncm: '22021000' };
    const b = { id: 2, nome: 'Coca Cola Lata', categoria_id: 1, marca_id: 1, preco_venda: 3.5, ncm: '22021000' };
    const r = sim.comparar(a, b);
    assert.ok(r.score >= 40);
  });

  await test('ClusterEngine agrupa', () => {
    const ce = new ClusterEngine();
    const clusters = ce.clusterizar([
      { id: 1, nome: 'Coca 2L', categoria_id: 1 },
      { id: 2, nome: 'Coca Lata', categoria_id: 1 },
      { id: 3, nome: 'Gelo', categoria_id: 2 }
    ]);
    assert.ok(clusters.length >= 2);
  });

  await test('SearchContext PDV vs compras', () => {
    const pdv = aplicarContexto({ entity: 'auto', origem: 'pdv', query: 'coca' });
    assert.strictEqual(pdv.entity, 'produto');
    const compras = aplicarContexto({ entity: 'auto', origem: 'compras', query: '11222333000199' });
    assert.strictEqual(compras.entity, 'fornecedor');
  });

  const db = await criarDb();
  MibService.resetInstance();
  SearchService.resetInstance();
  KnowledgeService.resetInstance();

  const kg = KnowledgeService.getInstance(db);
  await kg.iniciar();

  await test('rebuild grafo', async () => {
    const r = await kg.rebuild({ leve: false });
    assert.ok(r.ok);
    assert.ok(r.nos >= 5);
    assert.ok(r.arestas >= 1);
  });

  await test('vendido junto gera arestas', () => {
    const edges = kg.graph.edgesFrom('produto:1', [REL.VENDIDO_JUNTO]);
    assert.ok(edges.length >= 1);
  });

  await test('recomendações', async () => {
    const rec = await kg.recommendations(1, 5);
    assert.ok(rec.recomendacoes.length >= 1);
  });

  await test('similares', async () => {
    const s = await kg.similar(1, 5);
    assert.ok(s.similares.some((x) => Number(x.id) === 2 || /coca/i.test(x.nome)));
  });

  await test('duplicados GTIN', async () => {
    const d = await kg.detectDuplicates();
    assert.ok((d.gtin || []).length >= 1 || (d.produtos || []).some((p) => p.tipo === 'gtin'));
  });

  await test('sugestão cadastro', async () => {
    const sug = await kg.sugerirCadastro({ nome: 'Coca Cola Zero 2L' });
    assert.ok(sug.produtos_semelhantes.length >= 1);
    assert.ok(sug.categoria || sug.marca || sug.confianca > 0);
  });

  await test('consulta MIIP', async () => {
    const m = await kg.consultarParaMiip({
      nome: 'Coca Cola 2L',
      gtin: '7891000100010'
    });
    assert.ok(m.encontradoPorGtin || m.similares.length >= 1);
  });

  await test('dashboard knowledge', async () => {
    const d = await kg.dashboard();
    assert.ok(d.graph.nos >= 1);
    assert.ok(typeof d.semCategoria === 'number');
  });

  await test('SearchService não regressa com contexto', async () => {
    const mib = MibService.getInstance(db);
    await mib.iniciar();
    const search = SearchService.getInstance(db, mib);
    await search.iniciar();
    const r = await search.search({
      entity: 'produto',
      query: 'coca',
      skipAuth: true,
      origem: 'pdv'
    });
    assert.ok(r.itens.length >= 1);
    assert.ok((r.meta.tempoMs || 0) < 80);
  });

  KnowledgeService.resetInstance();
  SearchService.resetInstance();
  MibService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });
  console.log('\nMIB-RC4.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
