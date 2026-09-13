/**
 * Testes — MIP Sprint 05 (Integração PDV ← MIP)
 * Sprint 09: MIP é oficial no PDV; legado = fallback quando MIP não encontra.
 * Executar: npm run test:mip-sprint05
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
  FLAG_CHAVE,
  LAYOUT_IDS,
  interpretarResultadoPdv,
  calcularPesoEtiquetaPdv
} = require('../../backend/motores/produto-identidade');

const CODIGO_TOLEDO_67 = '2000067012631';
const CODIGO_TOLEDO_52 = '2000052018945';
const CODIGO_LEGADO_BALANCA = '2000010014890';
const CODIGO_EAN = '7891234567890';

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
  const file = path.join(os.tmpdir(), `mip-s05-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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
  await run(db, `
    CREATE TABLE equipamentos_configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER NOT NULL,
      chave TEXT NOT NULL,
      valor TEXT,
      UNIQUE(equipamento_id, chave)
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
  return { db, file };
}

async function seedProduto(db, { codigo, nome, codigo_barras = null, unidade = 'UN', preco_venda = 10 }) {
  const r = await run(
    db,
    'INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda) VALUES (?, ?, ?, ?, ?)',
    [codigo, nome, codigo_barras, unidade, preco_venda]
  );
  const id = r.lastID;
  const sync = new ProdutoIdentificadoresService({ db });
  await sync.espelharCodigoEBarras(id, { codigo, codigo_barras });
  return id;
}

async function main() {
  console.log('\n=== MIP Sprint 05 — Integração PDV ===\n');

  setProdutoIdentidadeEnabled(false);
  delete process.env.PRODUTO_IDENTIDADE_ENABLED;

  await test('FLAG_CHAVE oficial', () => {
    assert.strictEqual(FLAG_CHAVE, 'produto_identidade_enabled');
  });

  await test('interpretarResultadoPdv — habilitado false → legado', () => {
    const r = interpretarResultadoPdv({ habilitado: false, encontrado: false });
    assert.strictEqual(r.acao, 'legado');
  });

  await test('interpretarResultadoPdv — etiqueta balança', () => {
    const r = interpretarResultadoPdv({
      habilitado: true,
      encontrado: true,
      produtoId: 67,
      strategy: 'ETIQUETA_BALANCA',
      etiquetaBalanca: true,
      meta: { plu: '67', valorTotal: 12.63, peso: 1.0, layoutId: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65 }
    });
    assert.strictEqual(r.acao, 'balanca');
    assert.strictEqual(r.produtoId, 67);
    assert.strictEqual(r.valorTotal, 12.63);
    assert.strictEqual(r.peso, 1);
  });

  await test('interpretarResultadoPdv — produto normal', () => {
    const r = interpretarResultadoPdv({
      habilitado: true,
      encontrado: true,
      produtoId: 5,
      strategy: 'EAN13',
      metodo: 'EAN13'
    });
    assert.strictEqual(r.acao, 'normal');
    assert.strictEqual(r.produtoId, 5);
  });

  await test('calcularPesoEtiquetaPdv — valor / preço', () => {
    const peso = calcularPesoEtiquetaPdv({ valorTotal: 12.63, peso: null }, 12.63);
    assert.ok(Math.abs(peso - 1) < 0.001);
  });

  {
    const { db, file } = await criarDb();
    try {
      const idEan = await seedProduto(db, {
        codigo: 'P-EAN',
        nome: 'Produto EAN',
        codigo_barras: CODIGO_EAN,
        unidade: 'UN',
        preco_venda: 5.5
      });
      const id67 = await seedProduto(db, {
        codigo: '67',
        nome: 'Banana Kg',
        unidade: 'KG',
        preco_venda: 12.63
      });
      const id52 = await seedProduto(db, {
        codigo: '52',
        nome: 'Tomate Kg',
        unidade: 'KG',
        preco_venda: 9.47
      });
      const id1 = await seedProduto(db, {
        codigo: '1',
        nome: 'Legado Kg',
        unidade: 'KG',
        preco_venda: 14.89
      });

      await test('Sprint 09 — flag global OFF não desliga MIP no PDV', async () => {
        setProdutoIdentidadeEnabled(false);
        const svc = new PdvProdutoIdentificacaoService({ db, isEnabled: () => false });
        const r = await svc.identificar(CODIGO_EAN, { origem: 'pdv' });
        assert.strictEqual(r.habilitado, true);
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.modo, 'mip');
        assert.strictEqual(r.produtoId, idEan);
        assert.strictEqual(r.fallbackLegado, false);
      });

      setProdutoIdentidadeEnabled(true);

      await test('EAN resolve via MIP (porta oficial PDV)', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar(CODIGO_EAN, { origem: 'pdv' });
        assert.strictEqual(r.habilitado, true);
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.modo, 'mip');
        assert.strictEqual(r.produtoId, idEan);
        assert.strictEqual(interpretarResultadoPdv(r).acao, 'normal');
      });

      await test('código interno via MIP', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar('67', { origem: 'pdv' });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id67);
      });

      await test('Toledo real 2000067012631 (layout configurado)', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar(CODIGO_TOLEDO_67, {
          origem: 'pdv',
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id67);
        assert.strictEqual(r.etiquetaBalanca, true);
        assert.strictEqual(r.meta.plu, '67');
        assert.strictEqual(r.meta.valorTotal, 12.63);
        const dec = interpretarResultadoPdv(r);
        assert.strictEqual(dec.acao, 'balanca');
        const peso = calcularPesoEtiquetaPdv(dec, 12.63);
        assert.ok(Math.abs(peso - 1) < 0.001);
      });

      await test('Toledo real 2000052018945', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar(CODIGO_TOLEDO_52, {
          origem: 'pdv',
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id52);
        assert.strictEqual(r.meta.plu, '52');
        assert.strictEqual(r.meta.valorTotal, 18.94);
      });

      await test('etiqueta legado CDS (default) compatível PDV antigo', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar(CODIGO_LEGADO_BALANCA, { origem: 'pdv' });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id1);
        assert.strictEqual(r.meta.layoutId, LAYOUT_IDS.LEGADO_CDS_VALOR_56);
        assert.strictEqual(r.meta.valorTotal, 14.89);
      });

      await test('produto inexistente → fallbackLegado (PDV usa legado)', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar('9999999999999', { origem: 'pdv' });
        assert.strictEqual(r.habilitado, true);
        assert.strictEqual(r.encontrado, false);
        assert.strictEqual(r.fallbackLegado, true);
        assert.strictEqual(interpretarResultadoPdv(r).acao, 'legado');
      });

      await test('PLU etiqueta sem produto → fallback legado + meta.plu', async () => {
        const svc = new PdvProdutoIdentificacaoService({ db });
        const r = await svc.identificar('2000099010001', {
          origem: 'pdv',
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, false);
        assert.strictEqual(r.fallbackLegado, true);
        assert.strictEqual(r.etiquetaBalanca, true);
        assert.strictEqual(r.meta.plu, '99');
        const dec = interpretarResultadoPdv(r);
        assert.strictEqual(dec.acao, 'legado');
        assert.strictEqual(dec.plu, '99');
      });

      await test('rota produtos exporta helpers de teste identificar', () => {
        const produtosRouter = require('../../backend/rotas/produtos');
        assert.strictEqual(typeof produtosRouter._obterPdvIdentificacaoService, 'function');
        assert.strictEqual(typeof produtosRouter._setPdvIdentificacaoServiceForTests, 'function');
      });

      await test('compatibilidade: decisão legado quando API antiga diz desabilitado', () => {
        const dec = interpretarResultadoPdv({
          habilitado: false,
          encontrado: false,
          modo: 'legado',
          codigoOriginal: CODIGO_EAN
        });
        assert.strictEqual(dec.acao, 'legado');
      });
    } finally {
      setProdutoIdentidadeEnabled(false);
      await closeDb(db);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou === 0) console.log('MIP Sprint 05 OK\n');
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
