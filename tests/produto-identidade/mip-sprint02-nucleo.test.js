/**
 * Testes — MIP Sprint 02 (Núcleo resolve + flag + strategies)
 * Executar: npm run test:mip-sprint02
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
  DetectorTipoCodigo,
  StrategyFactory,
  StrategyRegistry,
  IdentidadeResultadoDTO,
  IdentidadeStrategyBase,
  InternoStrategy,
  IdStrategy,
  Ean13Strategy,
  GtinStrategy,
  isProdutoIdentidadeEnabled,
  setProdutoIdentidadeEnabled,
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
  const file = path.join(os.tmpdir(), `mip-s02-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);
  await run(db, 'PRAGMA foreign_keys = ON');
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

async function seedProduto(db, { codigo, nome, codigo_barras }) {
  const r = await run(
    db,
    'INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda) VALUES (?, ?, ?, ?, ?)',
    [codigo, nome, codigo_barras || null, 'UN', 10]
  );
  const id = r.lastID;
  const sync = new ProdutoIdentificadoresService({ db });
  await sync.espelharCodigoEBarras(id, { codigo, codigo_barras });
  return id;
}

async function main() {
  console.log('\n=== MIP Sprint 02 — Núcleo ===\n');

  // Reset flag
  setProdutoIdentidadeEnabled(false);
  delete process.env.PRODUTO_IDENTIDADE_ENABLED;

  await test('feature flag default OFF', () => {
    assert.strictEqual(FLAG_CHAVE, 'produto_identidade_enabled');
    assert.strictEqual(isProdutoIdentidadeEnabled(), false);
  });

  await test('DTO desabilitado / encontrado / nao encontrado', () => {
    const d = IdentidadeResultadoDTO.desabilitado('X');
    assert.strictEqual(d.habilitado, false);
    assert.strictEqual(d.encontrado, false);
    const e = IdentidadeResultadoDTO.encontrado({
      produtoId: 1,
      produto: { id: 1 },
      metodo: 'INTERNO',
      strategy: 'INTERNO'
    });
    assert.strictEqual(e.encontrado, true);
    assert.ok(e.toJSON().produtoId === 1);
    const n = IdentidadeResultadoDTO.naoEncontrado({ codigoOriginal: 'z' });
    assert.strictEqual(n.encontrado, false);
  });

  await test('DetectorTipoCodigo candidatos', () => {
    const det = new DetectorTipoCodigo();
    assert.deepStrictEqual(det.detectar('7891234567890').candidatos[0], 'EAN13');
    assert.deepStrictEqual(det.detectar('17891234567890').candidatos[0], 'GTIN');
    const curto = det.detectar('67');
    assert.ok(curto.candidatos.includes('INTERNO'));
    assert.ok(curto.candidatos.includes('ID'));
    assert.ok(curto.candidatos.indexOf('INTERNO') < curto.candidatos.indexOf('ID'));
  });

  await test('StrategyRegistry + Factory padrão', () => {
    const registry = StrategyFactory.criarRegistryPadrao({ catalogo: {} });
    assert.ok(registry instanceof StrategyRegistry);
    assert.strictEqual(registry.tamanho, 6);
    assert.ok(registry.obter('ETIQUETA_BALANCA'));
    assert.ok(registry.obter('PLU'));
    assert.ok(registry.obter('INTERNO') instanceof InternoStrategy);
    assert.ok(registry.obter('ID') instanceof IdStrategy);
    assert.ok(registry.obter('EAN13') instanceof Ean13Strategy);
    assert.ok(registry.obter('GTIN') instanceof GtinStrategy);
    assert.ok(IdentidadeStrategyBase.prototype);
  });

  await test('resolve com flag OFF não consulta produto', async () => {
    setProdutoIdentidadeEnabled(false);
    const { db, file } = await criarDb();
    await seedProduto(db, { codigo: '67', nome: 'Queijo', codigo_barras: '7891234567890' });
    const mip = new ProdutoIdentidadeService({ db });
    const r = await mip.resolve('67');
    assert.strictEqual(r.habilitado, false);
    assert.strictEqual(r.encontrado, false);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('resolve INTERNO com flag ON', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await seedProduto(db, { codigo: 'ABC-1', nome: 'Item A', codigo_barras: null });
    const mip = new ProdutoIdentidadeService({ db });
    const r = await mip.resolve('ABC-1');
    assert.strictEqual(r.habilitado, true);
    assert.strictEqual(r.encontrado, true);
    assert.strictEqual(r.metodo, 'INTERNO');
    assert.strictEqual(r.produtoId, id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('resolve EAN13 com flag ON', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await seedProduto(db, {
      codigo: 'P1',
      nome: 'Barras',
      codigo_barras: '7891234567890'
    });
    const mip = new ProdutoIdentidadeService({ db });
    const r = await mip.resolve('7891234567890');
    assert.strictEqual(r.encontrado, true);
    assert.strictEqual(r.metodo, 'EAN13');
    assert.strictEqual(r.produtoId, id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('resolve GTIN com flag ON', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await seedProduto(db, {
      codigo: 'G1',
      nome: 'GtinProd',
      codigo_barras: '17891234567890'
    });
    const mip = new ProdutoIdentidadeService({ db });
    const r = await mip.resolve({ codigo: '17891234567890', contexto: {} });
    assert.strictEqual(r.encontrado, true);
    assert.strictEqual(r.metodo, 'GTIN');
    assert.strictEqual(r.produtoId, id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('resolve ID com flag ON', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await seedProduto(db, { codigo: 'ZX', nome: 'PorId', codigo_barras: null });
    const mip = new ProdutoIdentidadeService({ db });
    const r = await mip.resolve(String(id), { tipoForcado: 'ID' });
    assert.strictEqual(r.encontrado, true);
    assert.strictEqual(r.metodo, 'ID');
    assert.strictEqual(r.produtoId, id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('resolve codigo inexistente', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const mip = new ProdutoIdentidadeService({ db });
    const r = await mip.resolve('NAOEXISTE999');
    assert.strictEqual(r.encontrado, false);
    assert.strictEqual(r.habilitado, true);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('env PRODUTO_IDENTIDADE_ENABLED=true liga flag', () => {
    setProdutoIdentidadeEnabled(false);
    process.env.PRODUTO_IDENTIDADE_ENABLED = 'true';
    assert.strictEqual(isProdutoIdentidadeEnabled(), true);
    delete process.env.PRODUTO_IDENTIDADE_ENABLED;
    setProdutoIdentidadeEnabled(false);
  });

  // Restaura default OFF
  setProdutoIdentidadeEnabled(false);

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  console.log('MIP Sprint 02 OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
