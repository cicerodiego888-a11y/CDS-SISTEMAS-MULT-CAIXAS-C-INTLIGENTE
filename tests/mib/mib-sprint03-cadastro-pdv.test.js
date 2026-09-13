'use strict';

/**
 * CDS Sprint 03 — cadastro/PDV não destroem hits válidos do MIB.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  preservarHitsCadastro,
  resolverListaPdv,
  indiceDestaqueInicialPdv,
  resolverResultadoBuscaCadastro
} = require('../../frontend/shared/js/resolverBuscaCadastroProdutos.js');

const {
  obterSearchService,
  normalizarNomeBusca,
  MibService,
  SearchService
} = require('../../backend/motores/mib');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function item(id, nome, extra = {}) {
  return { id, nome, ...extra };
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib-s03-'));
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
          ['10', '7891000100101', 'ARROZ TIO JOAO 5KG', 1, 1],
          ['20', '7891000100202', 'FEIJAO CARIOCA', 1, 1],
          ['30', '7891000100303', 'OLEO DE SOJA', 1, 1]
        ];
        for (const [codigo, barras, nome, cat, marca] of rows) {
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

async function main() {
  const mibHits = [
    item(1709, 'PICOLE CREMOSO', {
      categoria_id: null,
      estoque_atual: 0,
      mib_match_tipo: 'NOME_EXATO',
      mib_match_rank: 5,
      mib_score: 1000
    }),
    item(1710, 'PICOLE CREMOSO', {
      categoria_id: null,
      estoque_atual: 0,
      mib_match_tipo: 'NOME_EXATO',
      mib_match_rank: 5,
      mib_score: 1000
    }),
    item(5, 'PICOLE COCO - cremoso', {
      categoria_id: 8,
      estoque_atual: 249,
      mib_match_tipo: 'TODOS_TERMOS_NO_NOME',
      mib_match_rank: 3,
      mib_score: 700
    }),
    item(3, 'PICOLE MORANGO - Cremoso', {
      categoria_id: 8,
      estoque_atual: 109,
      mib_match_tipo: 'TODOS_TERMOS_NO_NOME',
      mib_match_rank: 3,
      mib_score: 700
    })
  ];

  await test('TESTE 01 — MIB retorna produto sem categoria', () => {
    assert.ok(mibHits[0].categoria_id == null);
    const r = resolverResultadoBuscaCadastro({
      resultado: { itens: mibHits },
      fallbackItens: [item(5, 'PICOLE COCO - cremoso')]
    });
    assert.strictEqual(r.fonte, 'mib');
    assert.ok(r.itens.some((p) => Number(p.id) === 1709));
  });

  await test('TESTE 02 — Cadastro não elimina hit MIB sem categoria', () => {
    const out = preservarHitsCadastro(mibHits, {
      buscaAtiva: true,
      origemMib: true,
      categoriaId: '8'
    });
    assert.strictEqual(out.length, 4);
    assert.ok(out.some((p) => Number(p.id) === 1709));
    assert.ok(out.some((p) => Number(p.id) === 1710));
  });

  await test('TESTE 03 — busca ativa ignora agrupamento de categoria', () => {
    const out = preservarHitsCadastro(mibHits, {
      buscaAtiva: true,
      origemMib: true,
      categoriaId: '8'
    });
    assert.deepStrictEqual(out.map((p) => p.id), [1709, 1710, 5, 3]);
  });

  await test('TESTE 04 — sem busca categoria continua funcionando', () => {
    const out = preservarHitsCadastro(mibHits, {
      buscaAtiva: false,
      origemMib: false,
      categoriaId: '8'
    });
    assert.strictEqual(out.length, 2);
    assert.ok(out.every((p) => String(p.categoria_id) === '8'));
    assert.ok(!out.some((p) => Number(p.id) === 1709));
  });

  await test('TESTE 05 — MIB retorna produto com estoque 0', () => {
    assert.strictEqual(Number(mibHits[0].estoque_atual), 0);
    const r = resolverListaPdv({
      itensMib: mibHits,
      fallbackItens: [item(5, 'PICOLE COCO - cremoso', { estoque_atual: 249 })]
    });
    assert.strictEqual(r.fonte, 'mib');
    assert.ok(r.itens.some((p) => Number(p.id) === 1709 && Number(p.estoque_atual) === 0));
  });

  await test('TESTE 06 — PDV não trata estoque 0 como ausência', () => {
    const r = resolverListaPdv({ itensMib: [mibHits[0]], fallbackItens: [mibHits[2]] });
    assert.strictEqual(r.itens.length, 1);
    assert.strictEqual(r.itens[0].id, 1709);
    assert.strictEqual(indiceDestaqueInicialPdv(r.itens), 0);
  });

  await test('TESTE 07 — PDV não mistura MIB + fallback quando MIB possui hits', () => {
    const r = resolverListaPdv({
      itensMib: [mibHits[0], mibHits[1]],
      fallbackItens: [mibHits[2], mibHits[3], item(99, 'LOCAL')]
    });
    assert.strictEqual(r.fonte, 'mib');
    assert.strictEqual(r.itens.length, 2);
    assert.ok(!r.itens.some((p) => /COCO|MORANGO|LOCAL/i.test(p.nome)));
  });

  await test('TESTE 08 — fallback só ocorre com MIB vazio', () => {
    const r = resolverListaPdv({
      itensMib: [],
      fallbackItens: [item(10, 'PRODUTO LOCAL 1')]
    });
    assert.strictEqual(r.fonte, 'fallback');
    assert.strictEqual(r.itens[0].nome, 'PRODUTO LOCAL 1');
  });

  await test('TESTE 09 — não duplicar produto', () => {
    const r = resolverListaPdv({
      itensMib: [mibHits[0]],
      fallbackItens: [item(1709, 'PICOLE CREMOSO'), mibHits[2]]
    });
    assert.strictEqual(r.itens.filter((p) => Number(p.id) === 1709).length, 1);
  });

  await test('TESTE 10 — nome exato permanece primeiro', () => {
    const r = resolverListaPdv({ itensMib: mibHits, fallbackItens: [] });
    assert.strictEqual(r.itens[0].nome, 'PICOLE CREMOSO');
    assert.strictEqual(r.itens[1].nome, 'PICOLE CREMOSO');
    assert.ok(r.itens[0].mib_match_rank >= r.itens[2].mib_match_rank);
  });

  await test('cadastro usa lista plana na busca MIB e PDV não faz merge', () => {
    const cadastro = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(cadastro.includes('preservarHitsCadastro'));
    assert.ok(cadastro.includes('listaPlanaBusca'));
    assert.ok(cadastro.includes('tabela-produtos-container'));
    assert.ok(cadastro.includes("origem: 'mib'"));

    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'), 'utf8');
    assert.ok(pdv.includes('resolverListaPdv'));
    assert.ok(!/ids\.has\(Number\(p\.id\)\) continue/.test(pdv));
    assert.ok(pdv.includes('Produto encontrado, mas sem estoque'));
    assert.ok(pdv.includes('Sem estoque'));

    const html = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/index.html'), 'utf8');
    assert.ok(html.includes('resolverBuscaCadastroProdutos.js'));
  });

  const db = await criarDb();
  MibService.resetInstance();
  SearchService.resetInstance();
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

  await test('TESTE 11 — código continua funcionando', async () => {
    const r = await svc.search({ ...ctx, query: '10' });
    assert.ok(r.itens.some((p) => String(p.codigo) === '10'));
    const lista = resolverListaPdv({ itensMib: r.itens, fallbackItens: [item(99, 'LOCAL')] });
    assert.strictEqual(lista.fonte, 'mib');
    assert.ok(lista.itens.some((p) => String(p.codigo) === '10'));
  });

  await test('TESTE 12 — EAN continua funcionando', async () => {
    const r = await svc.search({ ...ctx, query: '7891000100101' });
    assert.ok(r.itens.length >= 1);
    const lista = resolverListaPdv({ itensMib: r.itens, fallbackItens: [] });
    assert.strictEqual(lista.fonte, 'mib');
  });

  await test('TESTE 13 — PLU continua funcionando', async () => {
    const r = await svc.search({ ...ctx, query: 'PLU10' });
    assert.ok(r.itens.length >= 1);
    const lista = resolverListaPdv({ itensMib: r.itens, fallbackItens: [] });
    assert.strictEqual(lista.fonte, 'mib');
  });

  MibService.resetInstance();
  SearchService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nCDS Sprint 03 cadastro/PDV OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
