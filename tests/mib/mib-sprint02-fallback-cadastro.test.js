'use strict';

/**
 * MIB Sprint 02 — isolamento do resultado MIB no cadastro de produtos.
 * Não mistura fallback local quando o MIB já devolveu itens válidos.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  itensMibValidos,
  mibPossuiResultadosValidos,
  resolverResultadoBuscaCadastro,
  preservarCamposRankingMib
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib-s02-'));
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
    item(3, 'PICOLE CREMOSO', { mib_match_tipo: 'NOME_EXATO', mib_match_rank: 5, mib_score: 1000 }),
    item(4, 'PICOLE CREMOSO CHOCOLATE', { mib_match_tipo: 'FRASE_EXATA', mib_match_rank: 4, mib_score: 900 })
  ];
  const locais = [
    item(1, 'PICOLE COCO - CREMOSO'),
    item(2, 'PICOLE MORANGO - CREMOSO'),
    item(5, 'PICOLE LIMAO'),
    item(6, 'PICOLE UVA'),
    item(7, 'PICOLE ABACAXI')
  ];

  await test('TESTE 01 — MIB com 2 resultados não mistura fallback', () => {
    const r = resolverResultadoBuscaCadastro({
      resultado: { itens: mibHits },
      fallbackItens: locais
    });
    assert.strictEqual(r.fonte, 'mib');
    assert.strictEqual(r.itens.length, 2);
    assert.deepStrictEqual(r.itens.map((p) => p.nome), [
      'PICOLE CREMOSO',
      'PICOLE CREMOSO CHOCOLATE'
    ]);
    assert.ok(!r.itens.some((p) => /COCO|MORANGO/i.test(p.nome)));
  });

  await test('TESTE 02 — MIB com 1 resultado ignora locais', () => {
    const r = resolverResultadoBuscaCadastro({
      resultado: { itens: [mibHits[0]] },
      fallbackItens: locais
    });
    assert.strictEqual(r.itens.length, 1);
    assert.strictEqual(r.itens[0].nome, 'PICOLE CREMOSO');
    assert.strictEqual(r.fonte, 'mib');
  });

  await test('TESTE 03 — MIB zero resultados usa fallback', () => {
    const r = resolverResultadoBuscaCadastro({
      resultado: { itens: [] },
      fallbackItens: [item(10, 'PRODUTO LOCAL 1'), item(11, 'PRODUTO LOCAL 2')]
    });
    assert.strictEqual(r.fonte, 'fallback');
    assert.strictEqual(r.itens.length, 2);
    assert.strictEqual(r.itens[0].nome, 'PRODUTO LOCAL 1');
  });

  await test('TESTE 04 — erro do MIB preserva fallback/resiliência', () => {
    const r = resolverResultadoBuscaCadastro({
      resultado: { itens: mibHits },
      erro: new Error('SearchService falhou'),
      fallbackItens: locais
    });
    assert.strictEqual(r.fonte, 'fallback');
    assert.ok(r.erro);
    assert.ok(r.itens.some((p) => /COCO/i.test(p.nome)));
  });

  await test('SDK indisponível usa fallback', () => {
    const r = resolverResultadoBuscaCadastro({
      sdkDisponivel: false,
      resultado: { itens: mibHits },
      fallbackItens: locais
    });
    assert.strictEqual(r.fonte, 'fallback');
    assert.strictEqual(r.itens.length, locais.length);
  });

  await test('TESTE 05 — ordem do MIB é preservada', () => {
    const r = resolverResultadoBuscaCadastro({
      resultado: {
        itens: [
          item(1, 'EXATO'),
          item(2, 'FRASE'),
          item(3, 'TERMOS')
        ]
      },
      fallbackItens: [item(9, 'LOCAL')]
    });
    assert.deepStrictEqual(r.itens.map((p) => p.nome), ['EXATO', 'FRASE', 'TERMOS']);
    assert.strictEqual(r.preservarOrdem, true);
  });

  await test('TESTE 06 — não duplica produto MIB com local', () => {
    const r = resolverResultadoBuscaCadastro({
      resultado: { itens: [mibHits[0]] },
      fallbackItens: [item(3, 'PICOLE CREMOSO'), ...locais]
    });
    assert.strictEqual(r.fonte, 'mib');
    assert.strictEqual(r.itens.filter((p) => Number(p.id) === 3).length, 1);
    assert.ok(!r.itens.some((p) => /COCO|MORANGO/i.test(p.nome)));
  });

  await test('array undefined/null não conta como resultado MIB', () => {
    assert.strictEqual(mibPossuiResultadosValidos(undefined), false);
    assert.strictEqual(mibPossuiResultadosValidos(null), false);
    assert.strictEqual(mibPossuiResultadosValidos({}), false);
    assert.strictEqual(mibPossuiResultadosValidos({ itens: null }), false);
    assert.strictEqual(itensMibValidos({ itens: [null, item(1, 'X')] }).length, 1);
  });

  await test('preserva campos de ranking do MIB', () => {
    const full = { id: 3, nome: 'PICOLE CREMOSO', codigo: '99' };
    const hit = {
      id: 3,
      mib_score: 1000,
      mib_match_tipo: 'NOME_EXATO',
      mib_match_rank: 5,
      _fonte: 'memoria'
    };
    const out = { ...full, ...preservarCamposRankingMib(hit) };
    assert.strictEqual(out.mib_score, 1000);
    assert.strictEqual(out.mib_match_tipo, 'NOME_EXATO');
    assert.strictEqual(out.mib_match_rank, 5);
    assert.strictEqual(out._fonteBusca, 'memoria');
    assert.strictEqual(out.nome, 'PICOLE CREMOSO');
  });

  await test('TESTE 10 — busca vazia restaura lista completa', () => {
    const r = resolverResultadoBuscaCadastro({
      consultaVazia: true,
      listaCompleta: [item(1, 'A'), item(2, 'B')],
      resultado: { itens: mibHits },
      fallbackItens: locais
    });
    assert.strictEqual(r.fonte, 'arvore');
    assert.strictEqual(r.itens.length, 2);
    assert.strictEqual(r.preservarOrdem, false);
  });

  await test('cadastro não mistura MIB com fallback local', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(!src.includes("_fonteBusca: 'local'"), 'merge local removido');
    assert.ok(!/itens\.push\(\{\s*\.\.\.p,\s*_fonteBusca:\s*'local'/.test(src));
    assert.ok(src.includes("origem: 'mib'"));
    assert.ok(src.includes('mibPossuiResultadosValidos'));
    assert.ok(src.includes('preservarOrdem'));
    assert.ok(src.includes('fallbackLocal: true'));
    assert.ok(src.includes('filtrarListaProdutosFallbackLocal'));
    assert.ok(src.includes("err.name === 'AbortError'"));
    assert.ok(src.includes('if (!termo)'));
    assert.ok(src.includes('restaurarArvoreProdutosOriginal'));
  });

  await test('scripts do cadastro carregam o resolver', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/app.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
    assert.ok(app.includes('resolverBuscaCadastroProdutos.js'));
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

  await test('TESTE 07 — busca por código', async () => {
    const r = await svc.search({ ...ctx, query: '10' });
    assert.ok(r.itens.some((p) => String(p.codigo) === '10'));
    const lista = resolverResultadoBuscaCadastro({
      resultado: r,
      fallbackItens: locais
    });
    assert.strictEqual(lista.fonte, 'mib');
    assert.ok(lista.itens.some((p) => String(p.codigo) === '10'));
    assert.ok(!lista.itens.some((p) => /COCO|MORANGO/i.test(p.nome)));
  });

  await test('TESTE 08 — EAN/GTIN', async () => {
    const r = await svc.search({ ...ctx, query: '7891000100101' });
    assert.ok(r.itens.length >= 1);
    const lista = resolverResultadoBuscaCadastro({
      resultado: r,
      fallbackItens: locais
    });
    assert.strictEqual(lista.fonte, 'mib');
    assert.ok(lista.itens.some((p) => String(p.codigo_barras) === '7891000100101' || /ARROZ/i.test(p.nome)));
  });

  await test('TESTE 09 — PLU', async () => {
    const r = await svc.search({ ...ctx, query: 'PLU10' });
    assert.ok(r.itens.length >= 1);
    const lista = resolverResultadoBuscaCadastro({
      resultado: r,
      fallbackItens: locais
    });
    assert.strictEqual(lista.fonte, 'mib');
  });

  MibService.resetInstance();
  SearchService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nMIB Sprint 02 fallback cadastro OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
