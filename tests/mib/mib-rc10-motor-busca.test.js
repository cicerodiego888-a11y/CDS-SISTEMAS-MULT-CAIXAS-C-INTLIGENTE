'use strict';

/**
 * MIB-RC1.0 — testes do Motor Inteligente de Busca
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  normalizarNomeBusca,
  MibService,
  RankingEngine,
  CacheEngine
} = require('../../backend/motores/mib');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log('OK', nome);
    })
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function criarDbTemp() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib-'));
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
          produto_id INTEGER,
          tipo TEXT,
          codigo TEXT,
          ativo INTEGER DEFAULT 1,
          principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE promocoes (
          id INTEGER PRIMARY KEY,
          produto_id INTEGER,
          status TEXT,
          data_inicio TEXT,
          data_fim TEXT,
          preco_promocional REAL,
          desconto_percentual REAL
        )`);
        db.run(`CREATE TABLE produto_atacado (
          id INTEGER PRIMARY KEY,
          produto_id INTEGER,
          preco_atacado REAL,
          quantidade_minima REAL
        )`);
        db.run(
          `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, preco_venda, ativo)
           VALUES
           ('100', '7891000100103', 'Arroz Tio João Tipo 1 5Kg', ?, 25.9, 1),
           ('200', '7891000200203', 'Leite Integral 1L', ?, 5.5, 1),
           ('300', NULL, 'Café Torrado 500g', ?, 18.0, 1)`,
          [
            normalizarNomeBusca('Arroz Tio João Tipo 1 5Kg'),
            normalizarNomeBusca('Leite Integral 1L'),
            normalizarNomeBusca('Café Torrado 500g')
          ],
          (insErr) => {
            if (insErr) return reject(insErr);
            db.run(
              `INSERT INTO produto_identificadores (produto_id, tipo, codigo, ativo, principal)
               VALUES (1, 'PLU', '1234', 1, 1)`,
              (pluErr) => (pluErr ? reject(pluErr) : resolve({ db, arquivo, dir }))
            );
          }
        );
      });
    });
  });
}

async function main() {
  await test('normalizarNomeBusca remove acentos/espaços/pontuação', () => {
    assert.strictEqual(
      normalizarNomeBusca('Arroz Tio João Tipo 1 5Kg'),
      'arroztiojoaotipo15kg'
    );
    assert.strictEqual(normalizarNomeBusca('CAFÉ!!!'), 'cafe');
  });

  await test('CacheEngine LRU hit/miss', () => {
    const cache = new CacheEngine(2);
    cache.set('a', [{ id: 1 }]);
    assert.ok(cache.get('a'));
    assert.strictEqual(cache.stats().hits, 1);
    assert.strictEqual(cache.get('x'), undefined);
    assert.strictEqual(cache.stats().misses, 1);
  });

  await test('RankingEngine prioriza código exato', () => {
    const rank = new RankingEngine();
    const itens = [
      { id: 1, nome: 'Arroz', nome_busca: 'arroz', codigo: 'X', codigo_barras: '', plu: '' },
      { id: 2, nome: 'Outro', nome_busca: 'outro', codigo: '100', codigo_barras: '', plu: '' }
    ];
    const ord = rank.ordenar(itens, '100', '100', 'codigo');
    assert.strictEqual(ord[0].id, 2);
    assert.ok(ord[0].mib_score >= 100);
  });

  const { db } = await criarDbTemp();
  MibService.resetInstance();
  const mib = MibService.getInstance(db);
  await mib.iniciar();

  await test('busca por codigo exato', async () => {
    const r = await mib.buscar('100', { limite: 10 });
    assert.ok(r.itens.some((p) => String(p.codigo) === '100'));
  });

  await test('busca por codigo barras', async () => {
    const r = await mib.buscar('7891000100103', { limite: 10 });
    assert.ok(r.itens.some((p) => String(p.codigo_barras) === '7891000100103'));
  });

  await test('busca por PLU', async () => {
    const r = await mib.buscar('1234', { limite: 10 });
    assert.ok(r.itens.some((p) => Number(p.id) === 1));
  });

  await test('busca por nome_busca sem normalizar no SQL', async () => {
    const r = await mib.buscar('Arroz', { limite: 10 });
    assert.ok(r.itens.some((p) => /arroz/i.test(p.nome)));
    assert.ok(['memoria', 'sql', 'cache', 'incremental'].includes(r.meta.fonte));
  });

  await test('segunda busca usa cache', async () => {
    mib.engine.invalidarCache();
    await mib.buscar('leite', { limite: 10 });
    const r2 = await mib.buscar('leite', { limite: 10 });
    assert.strictEqual(r2.meta.fonte, 'cache');
  });

  await test('pesquisa incremental refina sem SQL', async () => {
    mib.engine.invalidarCache();
    mib.engine._incremental = null;
    const r1 = await mib.buscar('ar', { limite: 20 });
    assert.ok(r1.itens.length >= 1);
    const sqlAntes = mib.engine.metricas.sql;
    const r2 = await mib.buscar('arro', { limite: 20 });
    assert.ok(r2.itens.some((p) => /arroz/i.test(p.nome)));
    // incremental ou cache/memoria — não deve aumentar SQL se prefixo válido
    assert.ok(
      r2.meta.fonte === 'incremental'
      || r2.meta.fonte === 'memoria'
      || r2.meta.fonte === 'cache'
      || mib.engine.metricas.sql === sqlAntes
    );
  });

  await test('cancelamento incrementa métrica ao iniciar nova busca', async () => {
    mib.engine.metricas.canceladas = 0;
    // Simula pesquisa em voo
    mib.engine._atual = { id: 999, cancelled: false };
    const canceladasAntes = mib.engine.metricas.canceladas;
    mib.engine.cancelarAtual();
    assert.strictEqual(mib.engine.metricas.canceladas, canceladasAntes + 1);
    assert.strictEqual(mib.engine._atual.cancelled, true);
    const r = await mib.buscar('cafe', { limite: 10 });
    assert.ok(Array.isArray(r.itens));
  });

  await test('diagnostico e benchmark respondem', async () => {
    const diag = mib.diagnostico();
    assert.strictEqual(diag.motor, 'MIB');
    assert.ok(diag.produtosCarregados >= 3);
    const bench = await mib.executarBenchmark({ termo: 'arroz', tamanhos: [10, 100] });
    assert.ok(Array.isArray(bench.resultados));
    assert.ok(bench.resultados.length >= 2);
  });

  await new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch (_) {
      resolve();
    }
    setTimeout(resolve, 500);
  });
  console.log('\nMIB-RC1.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
