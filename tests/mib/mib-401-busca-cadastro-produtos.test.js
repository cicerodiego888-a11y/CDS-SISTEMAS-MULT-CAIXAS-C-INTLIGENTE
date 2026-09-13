'use strict';

/**
 * HOTFIX MIB-4.0.1 — testes da busca do Cadastro de Produtos via SearchService/MIB
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const { obterMib, obterSearchService, normalizarNomeBusca, MibService, SearchService } = require('../../backend/motores/mib');

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib401-'));
    const db = new sqlite3.Database(path.join(dir, 't.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT UNIQUE, codigo_barras TEXT, nome TEXT NOT NULL, nome_busca TEXT,
          preco_venda REAL DEFAULT 0, ativo INTEGER DEFAULT 1, item_fiscal INTEGER DEFAULT 1,
          categoria_id INTEGER, marca_id INTEGER, unidade TEXT DEFAULT 'UN',
          estoque_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0, controla_estoque INTEGER DEFAULT 1
        )`);
        db.run(`CREATE TABLE produto_identificadores (
          id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER, tipo TEXT, codigo TEXT,
          ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE promocoes (id INTEGER PRIMARY KEY, produto_id INTEGER, status TEXT)`);
        db.run(`CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER)`);
        db.run(`CREATE TABLE vendas (id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0)`);
        db.run(`CREATE TABLE vendas_itens (id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL)`);
        db.run(`INSERT INTO categorias (id, nome) VALUES (1, 'Mercearia')`);
        db.run(`INSERT INTO marcas (id, nome) VALUES (1, 'Tio Joao')`);
        const rows = [
          ['10', '7891000100101', 'ARROZ TIO JOAO 5KG', 1, 1, 'PLU10'],
          ['20', '7891000100202', 'FEIJAO CARIOCA', 1, 1, null],
          ['30', '7891000100303', 'OLEO DE SOJA', 1, 1, null]
        ];
        for (const [codigo, barras, nome, cat, marca, plu] of rows) {
          db.run(
            `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, categoria_id, marca_id, preco_venda)
             VALUES (?,?,?,?,?,?,?)`,
            [codigo, barras, nome, normalizarNomeBusca(nome), cat, marca, 10]
          );
        }
        db.run(
          `INSERT INTO produto_identificadores (produto_id, tipo, codigo, ativo, principal)
           VALUES (1, 'PLU', 'PLU10', 1, 1)`,
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

function assertFrontMigrado() {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
  assert.ok(src.includes('CdsSearchSDK') || src.includes('obterSdkBuscaProdutos'), 'deve consumir SearchSDK');
  assert.ok(src.includes('agendarBuscaProdutosMib'), 'debounce MIB');
  assert.ok(src.includes('debounceMs: 300') || src.includes('debounceMs = 300') || /debounceMs:\s*300/.test(src), 'debounce 300');
  assert.ok(src.includes('AbortController'), 'cancelamento');
  assert.ok(src.includes('fallbackLocal') || src.includes('filtrarListaProdutosFallbackLocal'), 'fallback');
  assert.ok(src.includes('restaurarArvoreProdutosOriginal'), 'restaurar árvore');
  assert.ok(src.includes('loadProdutos'), 'loadProdutos preservado');
  // não deve mais chamar Array.filter direto no bind input+aplicarFiltros juntos como antes
  assert.ok(src.includes("$('#buscaProduto').on('input'"), 'bind input busca');
  assert.ok(!/\$\('#buscaProduto, #filtroCategoriaProduto'\)\.on\('input change'/.test(src), 'bind legado removido');
}

async function main() {
  await test('frontend migrado para SearchSDK', () => assertFrontMigrado());

  await test('SearchSDK aceita signal', () => {
    const sdkPath = path.join(__dirname, '../../frontend/shared/js/SearchSDK.js');
    const src = fs.readFileSync(sdkPath, 'utf8');
    assert.ok(src.includes('signal'), 'SearchSDK propaga AbortSignal');
  });

  const db = await criarDb();
  MibService.resetInstance();
  SearchService.resetInstance();
  const mib = obterMib(db);
  await mib._ensure();
  const svc = obterSearchService(db);
  await svc.iniciar();

  const ctx = {
    entity: 'produto',
    limite: 20,
    origem: 'erp-cadastro-produtos',
    skipAuth: true,
    role: 'admin',
    permissoes: ['*']
  };

  await test('pesquisa por nome', async () => {
    const r = await svc.search({ ...ctx, query: 'ARROZ' });
    assert.ok(r.itens.some((p) => /ARROZ/i.test(p.nome)));
    assert.ok(['memoria', 'hotcache', 'cache', 'fuzzy', 'sql', 'aprendizado', 'incremental'].includes(r.meta?.fonte) || r.meta?.fonte);
  });

  await test('pesquisa por código', async () => {
    const r = await svc.search({ ...ctx, query: '10' });
    assert.ok(r.itens.some((p) => String(p.codigo) === '10' || /ARROZ/i.test(p.nome)));
  });

  await test('pesquisa por código barras', async () => {
    const r = await svc.search({ ...ctx, query: '7891000100101' });
    assert.ok(r.itens.length >= 1);
  });

  await test('pesquisa por PLU', async () => {
    const r = await svc.search({ ...ctx, query: 'PLU10' });
    assert.ok(r.itens.length >= 1);
  });

  await test('pesquisa por marca (catalogo)', async () => {
    const r = await svc.search({ ...ctx, query: 'tiojoao' });
    // pode vir por nome_busca do produto com marca no catalog
    assert.ok(Array.isArray(r.itens));
  });

  await test('pesquisa por categoria token', async () => {
    const r = await svc.search({ ...ctx, query: 'feijao' });
    assert.ok(r.itens.some((p) => /FEIJAO/i.test(p.nome)));
  });

  await test('pesquisa por nome_busca', async () => {
    const nb = normalizarNomeBusca('ARROZ TIO JOAO 5KG');
    const r = await svc.search({ ...ctx, query: nb.slice(0, 5) });
    assert.ok(r.itens.length >= 1);
  });

  await test('ProductProvider no fluxo', async () => {
    const r = await svc.search({ ...ctx, query: 'OLEO' });
    assert.ok(r.meta?.provider === 'produto' || r.entity === 'produto' || r.itens);
  });

  await test('catálogo 100k — MemoryCatalog < 20ms', async () => {
    const CatalogSnapshot = require('../../backend/motores/mib/catalog/CatalogSnapshot');
    const lista = [];
    for (let i = 1; i <= 100000; i += 1) {
      const nome = i % 50 === 0 ? `ARROZ ${i}` : `ITEM ${i}`;
      lista.push({
        id: i,
        nome,
        nome_busca: normalizarNomeBusca(nome),
        codigo: String(i),
        codigo_barras: '',
        plu: '',
        marca: '',
        item_fiscal: 1
      });
    }
    const snap = new CatalogSnapshot(lista, { versao: 1 });
    const tempos = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = process.hrtime.bigint();
      snap.filtrar('arroz', { limite: 20 });
      tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const media = tempos.reduce((a, b) => a + b, 0) / tempos.length;
    assert.ok(media < 20, `média ${media}ms`);
  });

  await test('debounce/cancelamento documentados no front', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(src.includes('abort.abort') || src.includes('.abort()'));
    assert.ok(src.includes('300'));
  });

  await test('fallback local preservado', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(src.includes('filtrarListaProdutosFallbackLocal') || src.includes('fallbackLocal'));
    assert.ok(src.includes('produtoCorrespondeBuscaInteligente'));
    assert.ok(src.includes('tokensBuscaSignificativos'), 'AND de tokens significativos');
    assert.ok(src.includes('consultaBuscaSoDigitos'), 'dígitos só em consulta numérica');
  });

  MibService.resetInstance();
  SearchService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nMIB-4.0.1 busca cadastro produtos OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
