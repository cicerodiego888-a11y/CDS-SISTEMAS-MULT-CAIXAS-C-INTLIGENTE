/**
 * Testes — MIP Sprint 06 (Cadastro PLU + Produto Pesável)
 * Executar: npm run test:mip-sprint06
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
  validarPluOpcional,
  resolverFlagProdutoPesavel,
  setProdutoIdentidadeEnabled,
  StrategyFactory,
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
  const file = path.join(os.tmpdir(), `mip-s06-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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

async function main() {
  console.log('\n=== MIP Sprint 06 — Cadastro PLU / Pesável ===\n');

  setProdutoIdentidadeEnabled(false);

  await test('validarPluOpcional — vazio ok (compatibilidade)', () => {
    assert.strictEqual(validarPluOpcional(undefined).ok, true);
    assert.strictEqual(validarPluOpcional(undefined).informado, false);
    assert.strictEqual(validarPluOpcional('').ok, true);
    assert.strictEqual(validarPluOpcional('').valor, null);
    assert.strictEqual(validarPluOpcional('').informado, true);
  });

  await test('validarPluOpcional — dígitos e limite', () => {
    const ok = validarPluOpcional('67');
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.valor, '67');
    const bad = validarPluOpcional('abc');
    assert.strictEqual(bad.ok, false);
    const longo = validarPluOpcional('12345678901');
    assert.strictEqual(longo.ok, false);
  });

  await test('resolverFlagProdutoPesavel — aliases', () => {
    assert.strictEqual(resolverFlagProdutoPesavel({ produto_pesavel: 1 }), 1);
    assert.strictEqual(resolverFlagProdutoPesavel({ produto_fracionado: 1 }), 1);
    assert.strictEqual(resolverFlagProdutoPesavel({ vendido_por_peso: 0 }), 0);
    assert.strictEqual(resolverFlagProdutoPesavel({}), undefined);
  });

  await test('Detector inclui PLU para código curto', () => {
    const d = new DetectorTipoCodigo().detectar('67');
    assert.ok(d.candidatos.includes('INTERNO'));
    assert.ok(d.candidatos.includes('PLU'));
  });

  await test('StrategyFactory registra PluStrategy', () => {
    const reg = StrategyFactory.criarRegistryPadrao({ catalogo: {} });
    assert.ok(reg.obter('PLU'));
    assert.ok(reg.tamanho >= 6);
  });

  {
    const { db, file } = await criarDb();
    try {
      const sync = new ProdutoIdentificadoresService({ db });

      const rProd = await run(
        db,
        `INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda, produto_fracionado, vendido_por_peso)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['BANANA', 'Banana Kg', null, 'KG', 12.63, 1, 1]
      );
      const id = rProd.lastID;

      await test('dual-write sem plu — comportamento Sprint 01 intacto', async () => {
        const r = await sync.espelharCodigoEBarras(id, { codigo: 'BANANA', codigo_barras: null });
        assert.strictEqual(r.interno.acao, 'criado');
        assert.strictEqual(r.plu.acao, 'noop');
        const plu = await sync.obterPluPrincipal(id);
        assert.strictEqual(plu, null);
      });

      await test('dual-write com PLU cria identificador tipado', async () => {
        const r = await sync.espelharCodigoEBarras(id, {
          codigo: 'BANANA',
          codigo_barras: null,
          plu: '67'
        });
        assert.ok(['criado', 'atualizado', 'inalterado', 'promovido'].includes(r.plu.acao));
        assert.strictEqual(await sync.obterPluPrincipal(id), '67');
      });

      await test('dual-write PLU vazio desativa', async () => {
        const r = await sync.espelharCodigoEBarras(id, {
          codigo: 'BANANA',
          plu: ''
        });
        assert.strictEqual(r.plu.acao, 'desativado');
        assert.strictEqual(await sync.obterPluPrincipal(id), null);
      });

      await test('conflito PLU entre produtos', async () => {
        await sync.espelharCodigoEBarras(id, { codigo: 'BANANA', plu: '67' });
        const r2 = await run(
          db,
          `INSERT INTO produtos (codigo, nome, unidade, preco_venda) VALUES (?, ?, ?, ?)`,
          ['TOMATE', 'Tomate', 'KG', 9]
        );
        const id2 = r2.lastID;
        const conflito = await sync.espelharCodigoEBarras(id2, {
          codigo: 'TOMATE',
          plu: '67'
        });
        assert.strictEqual(conflito.plu.acao, 'conflito');
        assert.strictEqual(Number(conflito.plu.conflito.produtoId), id);
      });

      await test('resolve PLU tipado via PluStrategy (flag ON)', async () => {
        setProdutoIdentidadeEnabled(true);
        await sync.espelharCodigoEBarras(id, { codigo: 'BANANA', plu: '52' });
        const mip = new ProdutoIdentidadeService({ db, isEnabled: () => true });
        const r = await mip.resolve('52', { tipoForcado: 'PLU' });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id);
        assert.strictEqual(r.strategy, 'PLU');
        setProdutoIdentidadeEnabled(false);
      });

      await test('omitir plu no espelho não apaga PLU existente', async () => {
        await sync.espelharCodigoEBarras(id, { codigo: 'BANANA', plu: '99' });
        await sync.espelharCodigoEBarras(id, { codigo: 'BANANA', codigo_barras: '7891234567890' });
        assert.strictEqual(await sync.obterPluPrincipal(id), '99');
      });

      await test('subquery PLU no SELECT de listagem', async () => {
        const row = await get(db, `
          SELECT p.*,
            (SELECT pi.codigo FROM produto_identificadores pi
             WHERE pi.produto_id = p.id AND pi.tipo = 'PLU'
               AND COALESCE(pi.ativo,1)=1 AND COALESCE(pi.principal,0)=1
             ORDER BY pi.id DESC LIMIT 1) AS plu
          FROM produtos p WHERE p.id = ?
        `, [id]);
        assert.strictEqual(row.plu, '99');
        assert.strictEqual(Number(row.produto_fracionado), 1);
        assert.strictEqual(Number(row.vendido_por_peso), 1);
      });

      await test('cliente sem plu — create path espelho só codigo (noop plu)', async () => {
        const r3 = await run(
          db,
          `INSERT INTO produtos (codigo, nome, unidade, preco_venda) VALUES (?, ?, ?, ?)`,
          ['COMUM', 'Produto Comum', 'UN', 1]
        );
        const id3 = r3.lastID;
        const r = await sync.espelharCodigoEBarras(id3, { codigo: 'COMUM', codigo_barras: '7891111111111' });
        assert.strictEqual(r.plu.acao, 'noop');
        assert.ok(r.interno.registro);
        assert.ok(r.barras.registro);
      });
    } finally {
      setProdutoIdentidadeEnabled(false);
      await closeDb(db);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou === 0) console.log('MIP Sprint 06 OK\n');
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
