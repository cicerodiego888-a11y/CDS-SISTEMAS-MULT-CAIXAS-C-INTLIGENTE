/**
 * Testes — MIP Sprint 09 (MIP como motor oficial do PDV)
 * Executar: npm run test:mip-sprint09
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresService,
  PdvProdutoIdentificacaoService,
  setProdutoIdentidadeEnabled,
  LAYOUT_IDS,
  interpretarResultadoPdv
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
  const file = path.join(os.tmpdir(), `mip-s09-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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

async function main() {
  console.log('\n=== MIP Sprint 09 — MIP oficial no PDV ===\n');

  setProdutoIdentidadeEnabled(false);
  delete process.env.PRODUTO_IDENTIDADE_ENABLED;

  await test('PDV frontend não depende mais da flag (sempre MIP→legado)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/pdv/js/pdv.js'),
      'utf8'
    );
    assert.ok(
      src.includes('adicionarProdutoPorCodigoViaMip(codigoDigitado)'),
      'PDV deve chamar MIP primeiro'
    );
    assert.ok(
      !src.includes('if (pdvMipHabilitado)'),
      'PDV não deve ramificar por pdvMipHabilitado'
    );
    assert.ok(
      src.includes('adicionarProdutoPorCodigoLegado(codigoDigitado)'),
      'legado permanece como fallback'
    );
    assert.ok(
      !src.includes('/configuracoes/produto_identidade_enabled'),
      'PDV não deve consultar produto_identidade_enabled'
    );
  });

  {
    const { db, file } = await criarDb();
    try {
      const sync = new ProdutoIdentificadoresService({ db });

      const idInterno = (await run(
        db,
        `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda)
         VALUES (?, ?, ?, ?, ?)`,
        ['INT-01', 'Produto Interno', null, 'UN', 3]
      )).lastID;
      await sync.espelharCodigoEBarras(idInterno, { codigo: 'INT-01', codigo_barras: null });

      const idEan = (await run(
        db,
        `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda)
         VALUES (?, ?, ?, ?, ?)`,
        ['EAN-01', 'Produto EAN', '7891000100103', 'UN', 5]
      )).lastID;
      await sync.espelharCodigoEBarras(idEan, {
        codigo: 'EAN-01',
        codigo_barras: '7891000100103'
      });

      const idGtin = (await run(
        db,
        `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda)
         VALUES (?, ?, ?, ?, ?)`,
        ['GTIN-01', 'Produto GTIN', '17891000100100', 'UN', 7]
      )).lastID;
      await sync.espelharCodigoEBarras(idGtin, {
        codigo: 'GTIN-01',
        codigo_barras: '17891000100100'
      });

      const idPlu = (await run(
        db,
        `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda)
         VALUES (?, ?, ?, ?, ?)`,
        ['BANANA', 'Banana Kg', null, 'KG', 12.63]
      )).lastID;
      await sync.espelharCodigoEBarras(idPlu, {
        codigo: 'BANANA',
        codigo_barras: null,
        plu: '67'
      });

      const pdv = new PdvProdutoIdentificacaoService({ db });

      await test('sem configuração — MIP resolve com flag global OFF', async () => {
        setProdutoIdentidadeEnabled(false);
        const r = await pdv.identificar('INT-01');
        assert.strictEqual(r.habilitado, true);
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, idInterno);
        assert.strictEqual(r.modo, 'mip');
      });

      await test('código interno', async () => {
        const r = await pdv.identificar('INT-01');
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, idInterno);
      });

      await test('EAN / código de barras', async () => {
        const r = await pdv.identificar('7891000100103');
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, idEan);
      });

      await test('GTIN', async () => {
        const r = await pdv.identificar('17891000100100');
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, idGtin);
      });

      await test('PLU', async () => {
        const r = await pdv.identificar('67');
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, idPlu);
        assert.strictEqual(r.strategy, 'PLU');
      });

      await test('layout Toledo (etiqueta balança)', async () => {
        const r = await pdv.identificar('2000067012631', {
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, idPlu);
        assert.strictEqual(r.etiquetaBalanca, true);
        assert.strictEqual(r.meta.plu, '67');
      });

      await test('MIP miss → fallbackLegado (legado permanece)', async () => {
        const r = await pdv.identificar('CODIGO-INEXISTENTE-XYZ');
        assert.strictEqual(r.encontrado, false);
        assert.strictEqual(r.fallbackLegado, true);
        assert.strictEqual(interpretarResultadoPdv(r).acao, 'legado');
      });
    } finally {
      setProdutoIdentidadeEnabled(false);
      await closeDb(db);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou === 0) console.log('MIP Sprint 09 OK\n');
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
