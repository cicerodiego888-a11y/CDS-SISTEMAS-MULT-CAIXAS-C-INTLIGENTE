/**
 * Testes — MIP Sprint 08 (Hardening / métricas / versão)
 * Executar: npm run test:mip-sprint08
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  MIP_VERSION,
  MIP_STATUS,
  MIP_RELEASE_DATE,
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresService,
  ProdutoIdentidadeService,
  setProdutoIdentidadeEnabled,
  mipMetrics,
  mipLogger,
  MipLookupCache,
  normalizarPlu,
  LayoutRegistry,
  FLAG_CHAVE
} = require('../../backend/motores/produto-identidade');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `mip-s08-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo VARCHAR(50) UNIQUE,
      nome VARCHAR(200) NOT NULL,
      codigo_barras TEXT,
      unidade TEXT,
      preco_venda DECIMAL(10,2) DEFAULT 0,
      ativo INTEGER DEFAULT 1
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
  return { db, file };
}

async function main() {
  console.log('\n=== MIP Sprint 08 — Hardening / Homologação ===\n');

  setProdutoIdentidadeEnabled(false);
  mipMetrics.reset();

  await test('versão oficial MIP V1.0.0 PRODUÇÃO', () => {
    assert.strictEqual(MIP_VERSION, '1.0.0');
    assert.strictEqual(MIP_STATUS, 'PRODUCAO');
    assert.strictEqual(MIP_RELEASE_DATE, '2026-07-19');
    assert.strictEqual(FLAG_CHAVE, 'produto_identidade_enabled');
  });

  await test('normalizarPlu compartilhado', () => {
    assert.strictEqual(normalizarPlu('00067'), '67');
    assert.strictEqual(normalizarPlu('0'), '0');
    assert.strictEqual(normalizarPlu('00'), '0');
    assert.strictEqual(normalizarPlu('0000'), '0');
  });

  await test('variantesPlu cobre 00 e 0000', () => {
    const { variantesPlu } = require('../../backend/motores/produto-identidade/utils/normalizarPlu');
    const v = variantesPlu('00');
    assert.ok(v.includes('00'));
    assert.ok(v.includes('0'));
    assert.ok(v.includes('0000'));
  });

  await test('LayoutRegistry ainda registra 3 layouts', () => {
    assert.strictEqual(LayoutRegistry.criarPadrao().tamanho, 3);
  });

  await test('MipLookupCache LRU + stats', () => {
    const c = new MipLookupCache(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    assert.strictEqual(c.get('a'), 1);
    c.set('d', 4);
    assert.strictEqual(c.get('b'), undefined);
    assert.ok(c.stats().hits >= 1);
  });

  await test('mipLogger API existe', () => {
    assert.strictEqual(typeof mipLogger.info, 'function');
    assert.strictEqual(typeof mipLogger.warn, 'function');
    assert.strictEqual(typeof mipLogger.error, 'function');
    assert.strictEqual(typeof mipLogger.debug, 'function');
  });

  await test('documentos oficiais existem', () => {
    const root = path.join(__dirname, '../../docs');
    assert.ok(fs.existsSync(path.join(root, 'MIP_VERSION.md')));
    assert.ok(fs.existsSync(path.join(root, 'CHANGELOG_MIP.md')));
    assert.ok(fs.existsSync(path.join(root, 'MIP_PERFORMANCE_V1.md')));
    assert.ok(fs.existsSync(path.join(root, 'ARQUITETURA_MOTOR_IDENTIFICACAO_PRODUTOS_V1.md')));
  });

  {
    const { db, file } = await criarDb();
    try {
      const r = await run(
        db,
        'INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda) VALUES (?, ?, ?, ?, ?)',
        ['X1', 'Prod', '7891234567890', 'UN', 5]
      );
      const sync = new ProdutoIdentificadoresService({ db });
      await sync.espelharCodigoEBarras(r.lastID, { codigo: 'X1', codigo_barras: '7891234567890' });

      setProdutoIdentidadeEnabled(true);
      mipMetrics.reset();

      await test('resolve anexa meta.tempoMs + flag + origem', async () => {
        const svc = new ProdutoIdentidadeService({ db, isEnabled: () => true });
        const res = await svc.resolve('7891234567890', { origem: 'homologacao' });
        assert.strictEqual(res.encontrado, true);
        assert.ok(res.meta);
        assert.ok(typeof res.meta.tempoMs === 'number');
        assert.strictEqual(res.meta.flag, FLAG_CHAVE);
        assert.strictEqual(res.meta.flagEnabled, true);
        assert.strictEqual(res.meta.origem, 'homologacao');
      });

      await test('métricas acumulam resoluções / EAN', async () => {
        const snap = mipMetrics.snapshot();
        assert.ok(snap.resolucoes >= 1);
        assert.ok(snap.encontrados >= 1);
        assert.ok(snap.ean13 >= 1 || snap.porStrategy.EAN13 >= 1);
        assert.ok(snap.tempoMedioMs >= 0);
      });

      await test('cache de catálogo reduz misses em resolve repetido', async () => {
        const svc = new ProdutoIdentidadeService({ db, isEnabled: () => true });
        svc.catalogo.limparCache();
        await svc.resolve('7891234567890', { origem: 'cache-test' });
        await svc.resolve('7891234567890', { origem: 'cache-test' });
        const st = svc.catalogo.cache.stats();
        assert.ok(st.hits >= 1);
      });

      await test('flag OFF registra desabilitados', async () => {
        mipMetrics.reset();
        const svc = new ProdutoIdentidadeService({ db, isEnabled: () => false });
        const res = await svc.resolve('7891234567890');
        assert.strictEqual(res.habilitado, false);
        assert.strictEqual(mipMetrics.snapshot().desabilitados, 1);
      });
    } finally {
      setProdutoIdentidadeEnabled(false);
      mipMetrics.reset();
      await closeDb(db);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou === 0) console.log('MIP Sprint 08 OK\n');
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
