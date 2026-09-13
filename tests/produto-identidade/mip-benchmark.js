/**
 * Benchmark MIP V1 — Legado (SQL direto) × MIP resolve (Sprint 08).
 * Executar: npm run test:mip-benchmark
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresService,
  ProdutoIdentidadeService,
  setProdutoIdentidadeEnabled,
  mipMetrics
} = require('../../backend/motores/produto-identidade');

const ITERACOES = 200;
const WARMUP = 20;

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

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function hrMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mediaMs: sum / sorted.length,
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    throughputOps: 1000 / (sum / sorted.length)
  };
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `mip-bench-${Date.now()}.db`);
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

  const sync = new ProdutoIdentificadoresService({ db });
  const ids = [];
  for (let i = 1; i <= 50; i += 1) {
    const codigo = `P${i}`;
    const ean = `7891234567${String(i).padStart(3, '0')}`;
    const r = await run(
      db,
      'INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda) VALUES (?, ?, ?, ?, ?)',
      [codigo, `Produto ${i}`, ean, 'UN', 10]
    );
    await sync.espelharCodigoEBarras(r.lastID, { codigo, codigo_barras: ean });
    ids.push({ id: r.lastID, codigo, ean });
  }
  return { db, file, ids };
}

async function medir(fn, n) {
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    const start = process.hrtime.bigint();
    await fn(i);
    samples.push(hrMs(start));
  }
  return stats(samples);
}

async function main() {
  console.log('\n=== MIP Benchmark V1 — Legado × MIP ===\n');
  console.log(`Warmup=${WARMUP}  Iterações=${ITERACOES}\n`);

  const { db, file, ids } = await criarDb();
  const alvo = ids[10];

  try {
    // Warmup legado
    for (let i = 0; i < WARMUP; i += 1) {
      await get(db, 'SELECT id FROM produtos WHERE codigo_barras = ? LIMIT 1', [alvo.ean]);
    }

    const legado = await medir(async () => {
      const row = await get(db, 'SELECT id FROM produtos WHERE codigo_barras = ? LIMIT 1', [alvo.ean]);
      assert.ok(row);
    }, ITERACOES);

    setProdutoIdentidadeEnabled(true);
    mipMetrics.reset();
    const mip = new ProdutoIdentidadeService({ db, isEnabled: () => true });

    for (let i = 0; i < WARMUP; i += 1) {
      await mip.resolve(alvo.ean, { origem: 'benchmark' });
    }
    mip.catalogo.limparCache();
    mipMetrics.reset();

    const mipStats = await medir(async () => {
      const r = await mip.resolve(alvo.ean, { origem: 'benchmark' });
      assert.strictEqual(r.encontrado, true);
    }, ITERACOES);

    const cacheStats = mip.catalogo.cache ? mip.catalogo.cache.stats() : null;
    const metricsSnap = mipMetrics.snapshot();

    const report = {
      geradoEm: new Date().toISOString(),
      iteracoes: ITERACOES,
      legado,
      mip: mipStats,
      cache: cacheStats,
      metrics: metricsSnap,
      razaoMedia: mipStats.mediaMs / legado.mediaMs
    };

    console.log('Legado (SQL codigo_barras):');
    console.log(`  média=${legado.mediaMs.toFixed(3)}ms  max=${legado.maxMs.toFixed(3)}ms  p95=${legado.p95Ms.toFixed(3)}ms  thr=${legado.throughputOps.toFixed(1)} ops/s`);
    console.log('MIP (resolve + strategies + cache):');
    console.log(`  média=${mipStats.mediaMs.toFixed(3)}ms  max=${mipStats.maxMs.toFixed(3)}ms  p95=${mipStats.p95Ms.toFixed(3)}ms  thr=${mipStats.throughputOps.toFixed(1)} ops/s`);
    console.log(`Razão média MIP/Legado: ${report.razaoMedia.toFixed(2)}x`);
    if (cacheStats) {
      console.log(`Cache hitRate=${cacheStats.hitRate} hits=${cacheStats.hits} misses=${cacheStats.misses}`);
    }
    console.log('\nMétricas MIP (snapshot):', JSON.stringify(metricsSnap, null, 2));

    const outDir = path.join(__dirname, '../../docs');
    const outJson = path.join(os.tmpdir(), `mip-benchmark-${Date.now()}.json`);
    fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
    console.log(`\nRelatório JSON: ${outJson}`);

    // Critério soft: MIP não deve ser catastroficamente mais lento em ambiente local (>50x)
    if (report.razaoMedia > 50) {
      console.warn('\nAVISO: MIP > 50x mais lento que legado neste ambiente (investigar).');
    }

    console.log('\nMIP Benchmark OK\n');
    process.exit(0);
  } finally {
    setProdutoIdentidadeEnabled(false);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
