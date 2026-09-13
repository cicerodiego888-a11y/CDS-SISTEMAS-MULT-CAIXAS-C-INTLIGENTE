/**
 * Testes — MIP Sprint 04 (Strategies de etiqueta + LayoutRegistry)
 * Códigos reais Toledo Prix 4 Uno (cliente):
 *   2000067012631 → PLU 67, R$ 12,63
 *   2000052018945 → PLU 52, R$ 18,94
 * Executar: npm run test:mip-sprint04
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresService,
  ProdutoIdentidadeService,
  DetectorTipoCodigo,
  StrategyFactory,
  LayoutRegistry,
  LegadoCdsValor56Layout,
  ToledoPrix4Valor55Layout,
  ToledoPrix4PesoLayout,
  EtiquetaBalancaStrategy,
  LAYOUT_IDS,
  LAYOUT_DEFAULT,
  CONFIG_CHAVE_STRATEGY,
  resolverLayoutId,
  setProdutoIdentidadeEnabled,
  TIPOS_IDENTIFICADOR
} = require('../../backend/motores/produto-identidade');

const CODIGO_TOLEDO_67 = '2000067012631';
const CODIGO_TOLEDO_52 = '2000052018945';
const CODIGO_LEGADO_EX = '2000010014890';
const CODIGO_PESO_EX = '2000067012640';

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
  const file = path.join(os.tmpdir(), `mip-s04-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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

async function seedProduto(db, { codigo, nome, preco_venda = 10, plu = null }) {
  const r = await run(
    db,
    'INSERT INTO produtos (codigo, nome, codigo_barras, unidade, preco_venda) VALUES (?, ?, ?, ?, ?)',
    [codigo, nome, null, 'KG', preco_venda]
  );
  const id = r.lastID;
  const sync = new ProdutoIdentificadoresService({ db });
  await sync.espelharCodigoEBarras(id, { codigo });
  if (plu != null) {
    await sync.upsertPrincipal(id, TIPOS_IDENTIFICADOR.PLU, String(plu), { origem: 'teste_sprint04' });
  }
  return id;
}

async function main() {
  console.log('\n=== MIP Sprint 04 — Etiqueta / Balança ===\n');

  setProdutoIdentidadeEnabled(false);

  await test('LAYOUT_DEFAULT é legado CDS 5+6', () => {
    assert.strictEqual(LAYOUT_DEFAULT, LAYOUT_IDS.LEGADO_CDS_VALOR_56);
    assert.strictEqual(CONFIG_CHAVE_STRATEGY, 'etiqueta.strategy');
  });

  await test('LayoutRegistry.criarPadrao registra 3 layouts', () => {
    const reg = LayoutRegistry.criarPadrao();
    assert.strictEqual(reg.tamanho, 3);
    assert.ok(reg.obter(LAYOUT_IDS.LEGADO_CDS_VALOR_56));
    assert.ok(reg.obter(LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65));
    assert.ok(reg.obter(LAYOUT_IDS.TOLEDO_PRIX4_PESO));
    assert.strictEqual(reg.obterOuDefault(null).id, LAYOUT_DEFAULT);
  });

  await test('Toledo Prix 4 Valor — código real 2000067012631 → PLU 67, R$ 12,63', () => {
    const layout = new ToledoPrix4Valor55Layout();
    const p = layout.parse(CODIGO_TOLEDO_67);
    assert.ok(p);
    assert.strictEqual(p.plu, '67');
    assert.strictEqual(p.pluRaw, '000067');
    assert.strictEqual(p.valorTotal, 12.63);
    assert.strictEqual(p.peso, null);
    assert.strictEqual(p.tipoPayload, 'VALOR');
    assert.strictEqual(p.layoutId, LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65);
  });

  await test('Toledo Prix 4 Valor — código real 2000052018945 → PLU 52, R$ 18,94', () => {
    const layout = new ToledoPrix4Valor55Layout();
    const p = layout.parse(CODIGO_TOLEDO_52);
    assert.ok(p);
    assert.strictEqual(p.plu, '52');
    assert.strictEqual(p.pluRaw, '000052');
    assert.strictEqual(p.valorTotal, 18.94);
    assert.strictEqual(p.tipoPayload, 'VALOR');
  });

  await test('Legado CDS Valor 5+6 — parse compatível PDV', () => {
    const layout = new LegadoCdsValor56Layout();
    const p = layout.parse(CODIGO_LEGADO_EX);
    assert.ok(p);
    assert.strictEqual(p.plu, '1');
    assert.strictEqual(p.pluRaw, '00001');
    assert.strictEqual(p.valorTotal, 14.89);
    assert.strictEqual(p.layoutId, LAYOUT_IDS.LEGADO_CDS_VALOR_56);
  });

  await test('Toledo Prix 4 Peso — gramas → kg', () => {
    const layout = new ToledoPrix4PesoLayout();
    const p = layout.parse(CODIGO_PESO_EX);
    assert.ok(p);
    assert.strictEqual(p.plu, '67');
    assert.strictEqual(p.pluRaw, '000067');
    assert.strictEqual(p.peso, 1.264);
    assert.strictEqual(p.valorTotal, null);
    assert.strictEqual(p.tipoPayload, 'PESO');
  });

  await test('mesmo código Toledo com layout legado produz valor diferente (não-Toledo)', () => {
    const legado = new LegadoCdsValor56Layout().parse(CODIGO_TOLEDO_67);
    const toledo = new ToledoPrix4Valor55Layout().parse(CODIGO_TOLEDO_67);
    assert.ok(legado && toledo);
    assert.strictEqual(toledo.valorTotal, 12.63);
    assert.notStrictEqual(legado.valorTotal, toledo.valorTotal);
    assert.strictEqual(legado.plu, '6');
    assert.strictEqual(legado.valorTotal, 7012.63);
  });

  await test('Detector marca ETIQUETA_BALANCA e não EAN13 para prefixo 2', () => {
    const d = new DetectorTipoCodigo().detectar(CODIGO_TOLEDO_67);
    assert.ok(d.candidatos.includes('ETIQUETA_BALANCA'));
    assert.ok(!d.candidatos.includes('EAN13'));
  });

  await test('resolverLayoutId — contexto.layoutStrategy tem prioridade', async () => {
    const id = await resolverLayoutId({
      layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65,
      equipamentoId: 99
    });
    assert.strictEqual(id, LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65);
  });

  await test('resolverLayoutId — default legado sem contexto', async () => {
    const id = await resolverLayoutId({});
    assert.strictEqual(id, LAYOUT_DEFAULT);
  });

  {
    const { db, file } = await criarDb();
    try {
      await test('resolverLayoutId — lê equipamentos_configuracoes', async () => {
        await run(
          db,
          'INSERT INTO equipamentos_configuracoes (equipamento_id, chave, valor) VALUES (?, ?, ?)',
          [7, CONFIG_CHAVE_STRATEGY, LAYOUT_IDS.TOLEDO_PRIX4_PESO]
        );
        const id = await resolverLayoutId({ equipamentoId: 7 }, { db });
        assert.strictEqual(id, LAYOUT_IDS.TOLEDO_PRIX4_PESO);
      });

      const id67 = await seedProduto(db, {
        codigo: '67',
        nome: 'Banana Kg',
        preco_venda: 12.63,
        plu: '67'
      });
      const id52 = await seedProduto(db, {
        codigo: '52',
        nome: 'Tomate Kg',
        preco_venda: 9.47,
        plu: '52'
      });
      const id1 = await seedProduto(db, {
        codigo: '1',
        nome: 'Produto Legado',
        preco_venda: 14.89
      });

      setProdutoIdentidadeEnabled(true);

      await test('resolve Toledo 2000067012631 → produto PLU 67 + valor 12,63', async () => {
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve(CODIGO_TOLEDO_67, {
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.strategy, 'ETIQUETA_BALANCA');
        assert.strictEqual(r.produtoId, id67);
        assert.strictEqual(r.meta.plu, '67');
        assert.strictEqual(r.meta.valorTotal, 12.63);
        assert.strictEqual(r.meta.layoutId, LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65);
        assert.ok(Math.abs(r.meta.peso - 1) < 0.001);
      });

      await test('resolve Toledo 2000052018945 → produto PLU 52 + valor 18,94', async () => {
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve(CODIGO_TOLEDO_52, {
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id52);
        assert.strictEqual(r.meta.plu, '52');
        assert.strictEqual(r.meta.valorTotal, 18.94);
      });

      await test('resolve via equipamento_id (config Toledo valor)', async () => {
        await run(
          db,
          'INSERT OR REPLACE INTO equipamentos_configuracoes (equipamento_id, chave, valor) VALUES (?, ?, ?)',
          [3, CONFIG_CHAVE_STRATEGY, LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65]
        );
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve(CODIGO_TOLEDO_67, { equipamentoId: 3 });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.meta.layoutId, LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65);
        assert.strictEqual(r.meta.valorTotal, 12.63);
      });

      await test('resolve legado 5+6 (default) encontra produto por codigo interno', async () => {
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve(CODIGO_LEGADO_EX);
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id1);
        assert.strictEqual(r.meta.plu, '1');
        assert.strictEqual(r.meta.valorTotal, 14.89);
        assert.strictEqual(r.meta.layoutId, LAYOUT_IDS.LEGADO_CDS_VALOR_56);
      });

      await test('resolve peso layout — meta.peso em kg', async () => {
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve(CODIGO_PESO_EX, {
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_PESO
        });
        assert.strictEqual(r.encontrado, true);
        assert.strictEqual(r.produtoId, id67);
        assert.strictEqual(r.meta.peso, 1.264);
        assert.strictEqual(r.meta.tipoPayload, 'PESO');
        assert.strictEqual(r.meta.valorTotal, null);
      });

      await test('PLU parseado sem produto → naoEncontrado com meta', async () => {
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve('2000099010001', {
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.encontrado, false);
        assert.strictEqual(r.strategy, 'ETIQUETA_BALANCA');
        assert.strictEqual(r.meta.plu, '99');
        assert.strictEqual(r.meta.produtoNaoEncontrado, true);
      });

      await test('flag OFF → desabilitado (não altera consumidores)', async () => {
        setProdutoIdentidadeEnabled(false);
        const svc = new ProdutoIdentidadeService({ db });
        const r = await svc.resolve(CODIGO_TOLEDO_67, {
          layoutStrategy: LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65
        });
        assert.strictEqual(r.habilitado, false);
        assert.strictEqual(r.encontrado, false);
        setProdutoIdentidadeEnabled(true);
      });

      await test('StrategyFactory registra EtiquetaBalanca antes de EAN13', () => {
        const reg = StrategyFactory.criarRegistryPadrao({ db });
        const nomes = reg.listar().map((s) => s.nome);
        assert.ok(nomes.includes('ETIQUETA_BALANCA'));
        assert.ok(nomes.indexOf('ETIQUETA_BALANCA') < nomes.indexOf('EAN13'));
      });

      await test('EtiquetaBalancaStrategy.canHandle só prefixo 2', () => {
        const s = new EtiquetaBalancaStrategy({ db });
        assert.strictEqual(s.canHandle(CODIGO_TOLEDO_67, {}, { digitos: CODIGO_TOLEDO_67 }), true);
        assert.strictEqual(s.canHandle('7891234567890', {}, { digitos: '7891234567890' }), false);
      });
    } finally {
      setProdutoIdentidadeEnabled(false);
      await closeDb(db);
      try {
        require('fs').unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
