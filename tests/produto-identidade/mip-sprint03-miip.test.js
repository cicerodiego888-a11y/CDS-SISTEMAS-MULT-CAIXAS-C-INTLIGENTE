/**
 * Testes — MIP Sprint 03 (Integração MIIP ← ProdutoRepository ← MIP)
 * Executar: npm run test:mip-sprint03
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const { ProdutoRepository } = require('../../backend/motores/miip/repositories/ProdutoRepository');
const produtoCache = require('../../backend/motores/miip/cache/ProdutoCache');
const MotorGTIN = require('../../backend/motores/miip/engines/MotorGTIN');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/MotorAssociacaoFornecedor');
const {
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresService,
  ProdutoIdentidadeService,
  setProdutoIdentidadeEnabled
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
  const file = path.join(os.tmpdir(), `mip-s03-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo VARCHAR(50) UNIQUE,
      nome VARCHAR(200) NOT NULL,
      codigo_barras TEXT,
      unidade TEXT,
      ncm TEXT,
      cest TEXT,
      categoria_id INTEGER,
      subcategoria_id INTEGER,
      fornecedor TEXT,
      preco_venda DECIMAL(10,2) DEFAULT 0,
      ativo INTEGER DEFAULT 1
    )
  `);
  await run(db, `
    CREATE TABLE miip_associacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      origem TEXT NOT NULL DEFAULT 'manual',
      fornecedor_cnpj TEXT,
      fornecedor_nome TEXT,
      codigo_fornecedor TEXT,
      codigo_barras TEXT,
      nome_item TEXT NOT NULL DEFAULT '',
      nome_normalizado TEXT,
      ncm TEXT,
      unidade TEXT,
      score REAL DEFAULT 0,
      confianca TEXT DEFAULT 'NENHUMA',
      status TEXT NOT NULL DEFAULT 'ativa',
      fonte TEXT NOT NULL DEFAULT 'local',
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
  return { db, file };
}

async function inserirProduto(db, dados) {
  const r = await run(
    db,
    `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, ncm, ativo)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      dados.codigo,
      dados.nome,
      dados.codigo_barras || null,
      dados.unidade || 'UN',
      dados.ncm || '10063021',
      dados.ativo != null ? dados.ativo : 1
    ]
  );
  return r.lastID;
}

async function main() {
  console.log('\n=== MIP Sprint 03 — Integração MIIP ===\n');

  setProdutoIdentidadeEnabled(false);
  delete process.env.PRODUTO_IDENTIDADE_ENABLED;
  if (typeof produtoCache.limpar === 'function') produtoCache.limpar();
  else if (typeof produtoCache.clear === 'function') produtoCache.clear();

  await test('flag OFF: buscarPorGtin usa apenas legado codigo_barras', async () => {
    setProdutoIdentidadeEnabled(false);
    const { db, file } = await criarDb();
    const id = await inserirProduto(db, {
      codigo: 'L1',
      nome: 'Legado',
      codigo_barras: '7891234567890'
    });
    // Sem dual-write de identificadores — só coluna legado
    const repo = new ProdutoRepository({ db, isMipEnabled: () => false });
    const snap = await repo.buscarPorGtin('7891234567890');
    assert.ok(snap);
    assert.strictEqual(snap.id, id);
    assert.strictEqual(snap.codigo_barras, '7891234567890');
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('flag ON: resolve via MIP (identificadores) antes do legado', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await inserirProduto(db, {
      codigo: 'M1',
      nome: 'ViaMip',
      codigo_barras: '7899999999999'
    });
    const sync = new ProdutoIdentificadoresService({ db });
    await sync.espelharCodigoEBarras(id, {
      codigo: 'M1',
      codigo_barras: '7899999999999'
    });

    // Remove codigo_barras do produto para forçar caminho identificadores
    await run(db, 'UPDATE produtos SET codigo_barras = NULL WHERE id = ?', [id]);

    const identidade = new ProdutoIdentidadeService({ db, isEnabled: () => true });
    const repo = new ProdutoRepository({
      db,
      identidadeService: identidade,
      isMipEnabled: () => true
    });

    if (typeof produtoCache.limpar === 'function') produtoCache.limpar();
    const snap = await repo.buscarPorGtin('7899999999999');
    assert.ok(snap, 'deveria achar via MIP mesmo sem codigo_barras na tabela produtos');
    assert.strictEqual(snap.id, id);
    assert.strictEqual(snap.nome, 'ViaMip');
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('flag ON: fallback legado quando MIP não encontra', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await inserirProduto(db, {
      codigo: 'F1',
      nome: 'SoLegado',
      codigo_barras: '7891111111111'
    });
    // Sem espelho em identificadores
    const repo = new ProdutoRepository({
      db,
      identidadeService: new ProdutoIdentidadeService({ db, isEnabled: () => true }),
      isMipEnabled: () => true
    });
    if (typeof produtoCache.limpar === 'function') produtoCache.limpar();
    const snap = await repo.buscarPorGtin('7891111111111');
    assert.ok(snap);
    assert.strictEqual(snap.id, id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('MotorGTIN continua funcionando via ProdutoRepository integrado', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await inserirProduto(db, {
      codigo: 'G1',
      nome: 'GtinMotor',
      codigo_barras: '7892222222222'
    });
    await new ProdutoIdentificadoresService({ db }).espelharCodigoEBarras(id, {
      codigo: 'G1',
      codigo_barras: '7892222222222'
    });

    const repo = new ProdutoRepository({
      db,
      identidadeService: new ProdutoIdentidadeService({ db, isEnabled: () => true }),
      isMipEnabled: () => true
    });
    if (typeof produtoCache.limpar === 'function') produtoCache.limpar();

    const motor = new MotorGTIN({ produtoRepository: repo });
    const candidatos = await motor.identificar({ codigoBarras: '7892222222222' });
    assert.ok(Array.isArray(candidatos));
    assert.ok(candidatos.length >= 1);
    assert.strictEqual(Number(candidatos[0].produtoId), id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('Fornecedor: buscarPorId inalterado (associação → produto)', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const id = await inserirProduto(db, {
      codigo: 'FORN1',
      nome: 'DoFornecedor',
      codigo_barras: null
    });
    await run(
      db,
      `INSERT INTO miip_associacoes
        (produto_id, fornecedor_cnpj, codigo_fornecedor, nome_item, status)
       VALUES (?, ?, ?, ?, 'ativa')`,
      [id, '12345678000199', 'SKU-99', 'Item forn']
    );

    const repo = new ProdutoRepository({ db, isMipEnabled: () => true });
    if (typeof produtoCache.limpar === 'function') produtoCache.limpar();

    const snap = await repo.buscarPorId(id);
    assert.ok(snap);
    assert.strictEqual(snap.nome, 'DoFornecedor');

    // Motor fornecedor com mocks leves + repo real para produto
    const motor = new MotorAssociacaoFornecedor({
      produtoRepository: repo,
      associacoesRepository: {
        async buscarPorFornecedorCodigo(cnpj, codigo) {
          if (cnpj === '12345678000199' && codigo === 'SKU-99') {
            return {
              id: 1,
              produtoId: id,
              fornecedorCnpj: cnpj,
              codigoFornecedor: codigo,
              status: 'ativa'
            };
          }
          return null;
        }
      }
    });
    const cands = await motor.identificar({
      fornecedorCnpj: '12.345.678/0001-99',
      codigoFornecedor: 'SKU-99',
      produtoNome: 'Item forn'
    });
    assert.ok(cands.length >= 1);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  await test('GTIN 14 dígitos via MIP', async () => {
    setProdutoIdentidadeEnabled(true);
    const { db, file } = await criarDb();
    const gtin14 = '17891234567890';
    const id = await inserirProduto(db, {
      codigo: 'G14',
      nome: 'Gtin14',
      codigo_barras: gtin14
    });
    await new ProdutoIdentificadoresService({ db }).espelharCodigoEBarras(id, {
      codigo: 'G14',
      codigo_barras: gtin14
    });
    const repo = new ProdutoRepository({
      db,
      identidadeService: new ProdutoIdentidadeService({ db, isEnabled: () => true }),
      isMipEnabled: () => true
    });
    if (typeof produtoCache.limpar === 'function') produtoCache.limpar();
    const snap = await repo.buscarPorGtin(gtin14);
    assert.ok(snap);
    assert.strictEqual(snap.id, id);
    await closeDb(db);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  });

  setProdutoIdentidadeEnabled(false);

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  console.log('MIP Sprint 03 OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
