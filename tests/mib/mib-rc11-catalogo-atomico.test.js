'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  normalizarNomeBusca,
  MibService,
  AtomicCatalog,
  AdaptiveCache,
  HotCache,
  EVENTOS
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib11-'));
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
          produto_id INTEGER, tipo TEXT, codigo TEXT,
          ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE promocoes (
          id INTEGER PRIMARY KEY, produto_id INTEGER, status TEXT,
          data_inicio TEXT, data_fim TEXT, preco_promocional REAL, desconto_percentual REAL
        )`);
        db.run(`CREATE TABLE produto_atacado (
          id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL
        )`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE vendas_itens (
          id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL
        )`);
        db.run(
          `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, preco_venda)
           VALUES
           ('10', '7891', 'Arroz Premium', ?, 10),
           ('20', '7892', 'Feijão Carioca', ?, 8),
           ('30', '7893', 'Café Especial', ?, 20)`,
          [
            normalizarNomeBusca('Arroz Premium'),
            normalizarNomeBusca('Feijão Carioca'),
            normalizarNomeBusca('Café Especial')
          ],
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

async function main() {
  await test('AdaptiveCache LFU protege frequentes', () => {
    const cache = new AdaptiveCache(3);
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.get('a');
    cache.get('a');
    cache.get('a');
    cache.set('c', [3]);
    cache.set('d', [4]); // deve evictar low-freq
    assert.ok(cache.get('a'), 'a frequente deve permanecer');
  });

  const db = await criarDb();
  MibService.resetInstance();
  const mib = MibService.getInstance(db);
  await mib.iniciar();

  await test('swap atômico incrementa versão', async () => {
    const v0 = mib.engine.catalog.versao;
    const snapA = mib.engine.catalog.ativo();
    const r = await mib.engine.catalog.rebuild();
    assert.ok(r.versao > v0);
    const snapB = mib.engine.catalog.ativo();
    assert.notStrictEqual(snapA, snapB);
    assert.ok(snapA.filtrar('arroz').length >= 0); // snapshot antigo ainda legível
  });

  await test('scheduleRefresh não bloqueia busca', async () => {
    const pRefresh = mib.refresh({ motivo: 'teste' });
    const busca = await mib.buscar('arroz', { limite: 10 });
    assert.ok(busca.itens.some((p) => /arroz/i.test(p.nome)));
    await pRefresh;
  });

  await test('patch COW + evento produto', async () => {
    let evento = null;
    mib.on(EVENTOS.ProdutoAlterado, (p) => { evento = p; });
    mib.engine.notificarProdutoAlterado({
      id: 1,
      nome: 'Arroz Premium Extra',
      nome_busca: normalizarNomeBusca('Arroz Premium Extra'),
      codigo: '10',
      preco: 11
    });
    assert.ok(evento);
    const item = mib.engine.catalog.atomic.get(1);
    assert.ok(String(item.nome).includes('Extra'));
  });

  await test('health check rápido', () => {
    const h = mib.health();
    assert.ok(['ok', 'degraded'].includes(h.status));
    assert.ok(typeof h.catalogVersion === 'number');
    assert.ok(typeof h.catalogSize === 'number');
    assert.ok(h.memoryUsage);
  });

  await test('HotCache rebuild', async () => {
    db.run(`INSERT INTO vendas (id, data_venda, cancelada) VALUES (1, date('now'), 0)`);
    db.run(`INSERT INTO vendas_itens (venda_id, produto_id, quantidade) VALUES (1, 1, 5)`);
    const hot = await mib.rebuildHotCache();
    assert.ok(hot.produtos >= 1);
  });

  await test('statistics persistíveis', async () => {
    await mib.buscar('cafe', { limite: 5 });
    await mib.engine.stats.persistir();
    const s = await mib.statistics();
    assert.ok(s.pesquisas >= 1);
  });

  await test('AtomicCatalog isolado', async () => {
    const atomic = new AtomicCatalog(db);
    const r1 = await atomic.rebuild();
    const ref1 = atomic.ativo();
    const r2 = await atomic.rebuild();
    assert.ok(r2.versao > r1.versao);
    assert.notStrictEqual(ref1, atomic.ativo());
  });

  MibService.resetInstance();
  await new Promise((resolve) => {
    db.close(() => resolve());
    setTimeout(resolve, 300);
  });
  console.log('\nMIB-RC1.1 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
