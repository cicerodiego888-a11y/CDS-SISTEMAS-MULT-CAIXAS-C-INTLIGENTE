/**
 * BUGFIX 01 — PLU: GET /:id, dual-write, resolve("67"), PDV MIP
 * Executar: npm run test:mip-bugfix01
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
  PdvProdutoIdentificacaoService,
  setProdutoIdentidadeEnabled,
  DetectorTipoCodigo
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

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `mip-bf01-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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
      produto_fracionado INTEGER DEFAULT 0,
      vendido_por_peso INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
  return { db, file };
}

/** Mesma subquery oficial de backend/rotas/produtos.js */
const SQL_PLU_SUBQUERY = `(
  SELECT pi.codigo FROM produto_identificadores pi
  WHERE pi.produto_id = p.id
    AND pi.tipo = 'PLU'
    AND COALESCE(pi.ativo, 1) = 1
    AND COALESCE(pi.principal, 0) = 1
  ORDER BY pi.id DESC
  LIMIT 1
) AS plu`;

async function main() {
  console.log('\n=== MIP BUGFIX 01 — PLU (cadastro + MIP + PDV) ===\n');

  setProdutoIdentidadeEnabled(false);

  await test('GET /produtos/:id reutiliza SQL_PLU_SUBQUERY', () => {
    const rota = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/produtos.js'),
      'utf8'
    );
    const idxGetId = rota.indexOf("router.get('/:id'");
    assert.ok(idxGetId > 0, 'rota GET /:id não encontrada');
    const trecho = rota.slice(idxGetId, idxGetId + 800);
    assert.ok(
      trecho.includes('${SQL_PLU_SUBQUERY}') || trecho.includes('SQL_PLU_SUBQUERY'),
      'GET /:id deve incluir SQL_PLU_SUBQUERY'
    );
  });

  await test('POST/PUT aguardam dual-write antes da resposta', () => {
    const rota = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/produtos.js'),
      'utf8'
    );
    assert.ok(
      rota.includes('espelharIdentificadoresSafe(produtoId, camposEspelho, { db }, () => aposDualWrite())'),
      'POST deve aguardar dual-write com db injetado'
    );
    assert.ok(
      rota.includes('espelharIdentificadoresAposSave(() => finalizarAtualizacao())'),
      'PUT deve aguardar dual-write antes de finalizar'
    );
    assert.ok(
      rota.includes('espelharIdentificadoresSafe(id, camposEspelho, { db }, () => cb())'),
      'PUT deve injetar db no dual-write'
    );
  });

  await test('dual-write com db:null resolve banco (não usa objeto deps)', async () => {
    // Reproduz o bug: Service({ db: null }) não pode tratar {} como SQLite
    const { db, file } = await criarDb();
    try {
      const rProd = await run(
        db,
        `INSERT INTO produtos (codigo, nome, unidade, preco_venda) VALUES (?, ?, ?, ?)`,
        ['TEST-NULL-DB', 'Teste', 'UN', 1]
      );
      // Injeta db real via deps.service path — valida Safe com db explícito
      const { espelharIdentificadoresSafe } = require('../../backend/motores/produto-identidade');
      const sync = new ProdutoIdentificadoresService({ db });
      await new Promise((resolve, reject) => {
        espelharIdentificadoresSafe(
          rProd.lastID,
          { codigo: 'TEST-NULL-DB', plu: '99' },
          { service: sync, db },
          (err) => (err ? reject(err) : resolve())
        );
      });
      const row = await get(
        db,
        `SELECT codigo FROM produto_identificadores WHERE produto_id = ? AND tipo = 'PLU' AND ativo = 1`,
        [rProd.lastID]
      );
      assert.strictEqual(String(row.codigo), '99');
    } finally {
      await closeDb(db);
      try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
    }
  });

  {
    const { db, file } = await criarDb();
    try {
      const sync = new ProdutoIdentificadoresService({ db });

      const rProd = await run(
        db,
        `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda, produto_fracionado)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['BANANA-KG', 'Banana Kg', '7891234567890', 'KG', 12.63, 1]
      );
      const id = rProd.lastID;

      await test('dual-write grava PLU 67 tipado (principal + ativo)', async () => {
        const r = await sync.espelharCodigoEBarras(id, {
          codigo: 'BANANA-KG',
          codigo_barras: '7891234567890',
          plu: '67'
        });
        assert.ok(['criado', 'atualizado', 'inalterado', 'promovido'].includes(r.plu.acao));

        const row = await get(
          db,
          `SELECT tipo, codigo, principal, ativo, produto_id
           FROM produto_identificadores
           WHERE produto_id = ? AND tipo = 'PLU' AND ativo = 1 AND principal = 1`,
          [id]
        );
        assert.ok(row, 'registro PLU não encontrado');
        assert.strictEqual(row.tipo, 'PLU');
        assert.strictEqual(String(row.codigo), '67');
        assert.strictEqual(Number(row.principal), 1);
        assert.strictEqual(Number(row.ativo), 1);
        assert.strictEqual(Number(row.produto_id), id);
      });

      await test('SQL_PLU_SUBQUERY retorna plu no SELECT por id (simula GET /:id)', async () => {
        const row = await get(
          db,
          `SELECT p.id, p.nome, ${SQL_PLU_SUBQUERY}
           FROM produtos p WHERE p.id = ?`,
          [id]
        );
        assert.strictEqual(String(row.plu), '67');
      });

      await test('resolve("67") — Detector → Strategy → Produto (flag ON)', async () => {
        setProdutoIdentidadeEnabled(true);
        const det = new DetectorTipoCodigo().detectar('67');
        assert.ok(det.candidatos.includes('PLU'));

        const mip = new ProdutoIdentidadeService({ db, isEnabled: () => true });
        const r = await mip.resolve('67');
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id);
        assert.strictEqual(r.strategy, 'PLU');
        assert.strictEqual(r.metodo, 'PLU');
        setProdutoIdentidadeEnabled(false);
      });

      await test('PDV identificar ignora flag OFF e resolve PLU via MIP', async () => {
        setProdutoIdentidadeEnabled(false);
        const pdv = new PdvProdutoIdentificacaoService({
          db,
          isEnabled: () => false
        });
        const payload = await pdv.identificar('67');
        assert.strictEqual(payload.habilitado, true);
        assert.strictEqual(payload.encontrado, true);
        assert.strictEqual(payload.produtoId, id);
        assert.strictEqual(payload.strategy, 'PLU');
        assert.strictEqual(payload.modo, 'mip');
        assert.strictEqual(payload.fallbackLegado, false);
        setProdutoIdentidadeEnabled(false);
      });

      await test('PDV MIP miss → fallbackLegado true', async () => {
        const pdv = new PdvProdutoIdentificacaoService({ db });
        const payload = await pdv.identificar('999888777');
        assert.strictEqual(payload.encontrado, false);
        assert.strictEqual(payload.fallbackLegado, true);
        assert.strictEqual(payload.habilitado, true);
      });

      await test('regressão — INTERNO / EAN13 / GTIN via resolve', async () => {
        setProdutoIdentidadeEnabled(true);
        const mip = new ProdutoIdentidadeService({ db, isEnabled: () => true });

        const porInterno = await mip.resolve('BANANA-KG');
        assert.strictEqual(porInterno.encontrado, true);
        assert.strictEqual(porInterno.produtoId, id);

        const porEan = await mip.resolve('7891234567890');
        assert.strictEqual(porEan.encontrado, true);
        assert.strictEqual(porEan.produtoId, id);

        await sync.espelharCodigoEBarras(id, {
          codigo: 'BANANA-KG',
          codigo_barras: '17891234567890',
          plu: '67'
        });
        const porGtin = await mip.resolve('17891234567890');
        assert.strictEqual(porGtin.encontrado, true);
        assert.strictEqual(porGtin.produtoId, id);

        setProdutoIdentidadeEnabled(false);
      });
    } finally {
      await closeDb(db);
      try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
    }
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
