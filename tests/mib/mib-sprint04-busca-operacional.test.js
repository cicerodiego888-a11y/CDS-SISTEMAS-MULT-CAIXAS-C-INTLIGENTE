'use strict';

/**
 * CDS Sprint 04 — busca operacional (Cadastro + PDV Express).
 * Não depende do ranking do MIB para encontrar produtos.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  criarBuscaOperacionalProdutosService,
  normalizarNomeBusca,
  normalizarTermoBusca,
  deveIgnorarRespostaBusca,
  LIMITE_PADRAO
} = require('../../backend/services/busca-operacional-produtos');

const {
  preservarHitsCadastro,
  resolverListaPdv,
  deveIgnorarRespostaBusca: deveIgnorarFront
} = require('../../frontend/shared/js/resolverBuscaCadastroProdutos.js');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's04-op-'));
    const db = new sqlite3.Database(path.join(dir, 't.db'), (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

async function prepararCatalogo(db, extras = []) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    codigo_barras TEXT,
    nome TEXT NOT NULL,
    nome_busca TEXT,
    preco_venda REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    item_fiscal INTEGER DEFAULT 1,
    categoria_id INTEGER,
    marca_id INTEGER,
    unidade TEXT DEFAULT 'UN',
    estoque_atual REAL DEFAULT 0,
    estoque_minimo REAL DEFAULT 0,
    controla_estoque INTEGER DEFAULT 1
  )`);
  await run(db, `CREATE TABLE produto_identificadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER,
    tipo TEXT,
    codigo TEXT,
    ativo INTEGER DEFAULT 1,
    principal INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
  await run(db, `CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
  await run(db, `CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL)`);
  await run(db, `CREATE INDEX idx_produtos_nome_busca ON produtos(nome_busca)`);
  await run(db, `INSERT INTO categorias (id, nome) VALUES (8, 'PIC - CREMOSA')`);

  const base = [
    {
      codigo: '811786068555591',
      barras: '',
      nome: 'PICOLE CREMOSO',
      categoria_id: null,
      estoque: 0
    },
    {
      codigo: '1010',
      barras: '',
      nome: 'PICOLE CREMOSO',
      categoria_id: null,
      estoque: 0
    },
    {
      codigo: '0003',
      barras: '7891000100003',
      nome: 'PICOLE COCO - cremoso',
      categoria_id: 8,
      estoque: 249
    },
    {
      codigo: '0001',
      barras: '7891000100001',
      nome: 'PICOLE MORANGO - Cremoso',
      categoria_id: 8,
      estoque: 109
    }
  ].concat(extras);

  for (const p of base) {
    await run(
      db,
      `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, categoria_id, estoque_atual, preco_venda)
       VALUES (?,?,?,?,?,?,?)`,
      [
        p.codigo,
        p.barras || '',
        p.nome,
        normalizarNomeBusca(p.nome),
        p.categoria_id == null ? null : p.categoria_id,
        p.estoque == null ? 0 : p.estoque,
        10
      ]
    );
  }

  await run(
    db,
    `INSERT INTO produto_identificadores (produto_id, tipo, codigo, ativo, principal)
     VALUES (2, 'PLU', '1010', 1, 1)`
  );
  await run(
    db,
    `INSERT INTO produto_identificadores (produto_id, tipo, codigo, ativo, principal)
     VALUES (3, 'GTIN', '7891000100003', 1, 1)`
  );
}

function nomes(itens) {
  return (itens || []).map((p) => p.nome);
}

function ids(itens) {
  return (itens || []).map((p) => Number(p.id));
}

async function main() {
  const db = await criarDb();
  await prepararCatalogo(db);

  let mibChamadas = 0;
  const svc = criarBuscaOperacionalProdutosService(db, {
    buscarSugestoesMib: async () => {
      mibChamadas += 1;
      return [{ id: 99, nome: 'PICOLE CREMOSO', codigo: 'SUGESTAO' }];
    }
  });

  await test('01. PICOLE → encontra PICOLE CREMOSO', async () => {
    const r = await svc.buscar({ q: 'PICOLE', incluirSugestoes: false });
    assert.ok(r.itens.filter((p) => p.nome === 'PICOLE CREMOSO').length >= 2);
    assert.ok(r.itens.some((p) => /COCO/i.test(p.nome)));
    assert.ok(r.itens.some((p) => /MORANGO/i.test(p.nome)));
    assert.strictEqual(r.itens[0].nome, 'PICOLE CREMOSO');
    assert.strictEqual(r.itens[1].nome, 'PICOLE CREMOSO');
  });

  await test('02. PICOLE CRE → prioriza PICOLE CREMOSO e isola prefixo', async () => {
    const r = await svc.buscar({ q: 'PICOLE CRE', incluirSugestoes: false });
    assert.ok(r.itens.length >= 2);
    assert.ok(r.itens.every((p) => p.nome === 'PICOLE CREMOSO'));
    assert.ok(!r.itens.some((p) => /COCO|MORANGO/i.test(p.nome)));
    assert.ok(r.itens.every((p) => p.busca_match_tipo === 'NOME_PREFIXO' || p.busca_match_tipo === 'NOME_EXATO'));
  });

  await test('03. PICOLE CREMOSO → somente os exatos no topo', async () => {
    const r = await svc.buscar({ q: 'PICOLE CREMOSO', incluirSugestoes: false });
    assert.strictEqual(r.itens.length, 2);
    assert.ok(r.itens.every((p) => p.nome === 'PICOLE CREMOSO'));
    assert.ok(r.itens.every((p) => p.busca_match_tipo === 'NOME_EXATO'));
    assert.ok(r.itens.some((p) => String(p.codigo) === '1010'));
    assert.ok(r.itens.some((p) => String(p.codigo) === '811786068555591'));
  });

  await test('04. busca com acento', async () => {
    const r = await svc.buscar({ q: 'picolé cremoso', incluirSugestoes: false });
    assert.strictEqual(r.itens.length, 2);
    assert.ok(r.itens.every((p) => p.nome === 'PICOLE CREMOSO'));
  });

  await test('05. busca sem acento', async () => {
    const a = normalizarTermoBusca('PICOLE CREMOSO');
    const b = normalizarTermoBusca('picolé cremoso');
    const c = normalizarTermoBusca('Picole Cremoso');
    assert.strictEqual(a, b);
    assert.strictEqual(a, c);
    const r = await svc.buscar({ q: 'Picole Cremoso', incluirSugestoes: false });
    assert.strictEqual(r.itens.length, 2);
  });

  await test('06. código exato', async () => {
    const r = await svc.buscar({ q: '1010', incluirSugestoes: false });
    assert.ok(r.itens.length >= 1);
    assert.strictEqual(String(r.itens[0].codigo), '1010');
    assert.strictEqual(r.itens[0].busca_match_tipo, 'IDENTIFICADOR_EXATO');
  });

  await test('07. EAN/GTIN exato', async () => {
    const r = await svc.buscar({ q: '7891000100003', incluirSugestoes: false });
    assert.ok(r.itens.length >= 1);
    assert.ok(r.itens.some((p) => /COCO/i.test(p.nome)));
    assert.strictEqual(r.itens[0].busca_match_tipo, 'IDENTIFICADOR_EXATO');
  });

  await test('08. PLU exato', async () => {
    const r = await svc.buscar({ q: '1010', incluirSugestoes: false });
    assert.ok(r.itens.some((p) => String(p.plu) === '1010' || String(p.codigo) === '1010'));
  });

  await test('09. produto sem categoria', async () => {
    const r = await svc.buscar({ q: 'PICOLE CREMOSO', incluirSugestoes: false });
    assert.ok(r.itens.every((p) => p.categoria_id == null));
    const cadastro = preservarHitsCadastro(r.itens, {
      buscaAtiva: true,
      origemOperacional: true,
      categoriaId: '8'
    });
    assert.strictEqual(cadastro.length, 2);
  });

  await test('10. produto estoque 0', async () => {
    const r = await svc.buscar({ q: 'PICOLE CREMOSO', incluirSugestoes: false });
    assert.ok(r.itens.every((p) => Number(p.estoque_atual) === 0));
    const pdv = resolverListaPdv({ itensOperacionais: r.itens, fallbackItens: [] });
    assert.strictEqual(pdv.fonte, 'operacional');
    assert.ok(pdv.itens.some((p) => Number(p.estoque_atual) === 0));
  });

  await test('11. dois produtos com mesmo nome', async () => {
    const r = await svc.buscar({ q: 'PICOLE CREMOSO', incluirSugestoes: false });
    assert.strictEqual(r.itens.length, 2);
    assert.notStrictEqual(String(r.itens[0].codigo), String(r.itens[1].codigo));
    assert.strictEqual(new Set(ids(r.itens)).size, 2);
  });

  await test('12. nenhum resultado operacional', async () => {
    mibChamadas = 0;
    const r = await svc.buscar({ q: 'PICOLE CERMOSO', incluirSugestoes: false });
    assert.strictEqual(r.itens.length, 0);
    assert.strictEqual(mibChamadas, 0);
  });

  await test('13. MIB somente após zero', async () => {
    mibChamadas = 0;
    const comHit = await svc.buscar({ q: 'PICOLE CREMOSO', incluirSugestoes: true });
    assert.ok(comHit.itens.length > 0);
    assert.strictEqual(comHit.sugestoes.length, 0);
    assert.strictEqual(comHit.meta.mib_consultado, false);
    assert.strictEqual(mibChamadas, 0);

    const semHit = await svc.buscar({ q: 'PICOLE CERMOSO', incluirSugestoes: true });
    assert.strictEqual(semHit.itens.length, 0);
    assert.strictEqual(semHit.meta.mib_consultado, true);
    assert.ok(mibChamadas >= 1);
    assert.ok(semHit.sugestoes.some((p) => p.nome === 'PICOLE CREMOSO'));
    const pdv = resolverListaPdv({
      itensOperacionais: [],
      sugestoesMib: semHit.sugestoes,
      fallbackItens: [{ id: 5, nome: 'CACHE LOCAL' }]
    });
    assert.strictEqual(pdv.itens.length, 0);
    assert.ok(pdv.sugestoes.some((p) => p.nome === 'PICOLE CREMOSO'));
    assert.ok(!pdv.itens.some((p) => p.nome === 'CACHE LOCAL'));
  });

  await test('busca também pela marca do produto', async () => {
    await run(db, `INSERT INTO marcas (id, nome) VALUES (7, 'Tio João')`);
    await run(
      db,
      `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, categoria_id, marca_id, estoque_atual, preco_venda)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['8801', '', 'ARROZ 5KG', normalizarNomeBusca('ARROZ 5KG'), null, 7, 3, 12]
    );
    const rExato = await svc.buscar({ q: 'tio joao', incluirSugestoes: false });
    assert.ok(rExato.itens.some((p) => String(p.codigo) === '8801'));
    assert.ok(rExato.itens.some((p) => p.busca_match_tipo === 'MARCA_EXATO' && String(p.codigo) === '8801'));

    const rAcento = await svc.buscar({ q: 'Tio João', incluirSugestoes: false });
    assert.ok(rAcento.itens.some((p) => String(p.codigo) === '8801'));

    const rPrefixo = await svc.buscar({ q: 'Tio', incluirSugestoes: false });
    assert.ok(rPrefixo.itens.some((p) => String(p.codigo) === '8801'));
    assert.ok(rPrefixo.itens.some((p) => String(p.marca || '').toLowerCase().includes('tio')));
  });

  await test('15. resultado antigo não sobrescreve busca nova', () => {
    assert.strictEqual(deveIgnorarRespostaBusca(1, 2), true);
    assert.strictEqual(deveIgnorarRespostaBusca(4, 4), false);
    assert.strictEqual(deveIgnorarFront(7, 8), true);
    const cadastro = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(cadastro.includes('deveIgnorarRespostaBusca'));
    assert.ok(cadastro.includes('AbortController'));
    assert.ok(cadastro.includes("err.name === 'AbortError'"));
    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'), 'utf8');
    assert.ok(pdv.includes('respostaAindaValida'));
    assert.ok(pdv.includes('AbortController'));
    assert.ok(pdv.includes('requisicaoAtual'));
  });

  await test('front Cadastro/PDV usam busca operacional e lista plana', () => {
    const cadastro = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(cadastro.includes('/produtos/busca-operacional'));
    assert.ok(cadastro.includes('debounceOperacionalMs: 180'));
    assert.ok(cadastro.includes("origem: 'operacional'"));
    assert.ok(cadastro.includes("origem: 'mib'"));
    assert.ok(cadastro.includes('listaPlanaBusca'));
    assert.ok(cadastro.includes('Sugestões'));
    assert.ok(cadastro.includes('limite=20'));

    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'), 'utf8');
    assert.ok(pdv.includes('/produtos/busca-operacional'));
    assert.ok(pdv.includes('pdv-autocomplete-sugestoes-titulo'));
    assert.ok(pdv.includes('Produto encontrado, mas sem estoque'));
    assert.ok(pdv.includes('itensOperacionais'));
    assert.ok(!/ids\.has\(Number\(p\.id\)\) continue/.test(pdv));

    const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/produtos.js'), 'utf8');
    assert.ok(rota.includes("router.get('/busca-operacional'"));
    assert.ok(rota.includes('criarBuscaOperacionalProdutosService'));
  });

  await test('núcleo do MIB não foi reescrito nesta sprint', () => {
    const ranking = fs.readFileSync(path.join(__dirname, '../../backend/motores/mib/core/RankingEngine.js'), 'utf8');
    assert.ok(ranking.includes('NOME_EXATO'));
    const engine = fs.readFileSync(path.join(__dirname, '../../backend/motores/mib/SearchEngine.js'), 'utf8');
    assert.ok(engine.includes('class SearchEngine'));
    const ai = fs.readFileSync(path.join(__dirname, '../../backend/motores/mib/ai/SearchAI.js'), 'utf8');
    assert.ok(ai.includes('SearchAI'));
  });

  await test('14 + 19. limite 20 e 5.000 produtos no backend', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's04-5k-'));
    const db5k = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(path.join(dir, 't.db'), (err) => (err ? reject(err) : resolve(d)));
    });
    await prepararCatalogo(db5k);

    await new Promise((resolve, reject) => {
      db5k.serialize(() => {
        db5k.run('BEGIN');
        const stmt = db5k.prepare(
          `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, categoria_id, estoque_atual, preco_venda)
           VALUES (?,?,?,?,?,?,?)`
        );
        for (let i = 1; i <= 5000; i += 1) {
          const nome = i <= 2
            ? `PICOLE CREMOSO LOTE ${i}`
            : (i % 40 === 0 ? `PICOLE ITEM ${i}` : `PRODUTO GENÉRICO ${i}`);
          stmt.run([
            String(200000 + i),
            '',
            nome,
            normalizarNomeBusca(nome),
            i % 7 === 0 ? null : 8,
            i % 11 === 0 ? 0 : 10,
            1
          ]);
        }
        stmt.finalize((err) => {
          if (err) return reject(err);
          db5k.run('COMMIT', (commitErr) => (commitErr ? reject(commitErr) : resolve()));
        });
      });
    });

    const svc5k = criarBuscaOperacionalProdutosService(db5k, {
      buscarSugestoesMib: async () => {
        throw new Error('MIB não deve ser consultado com hits operacionais');
      }
    });

    const t0 = Date.now();
    const r = await svc5k.buscar({ q: 'PICOLE', incluirSugestoes: true });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1500, `tempo ${elapsed}ms`);
    assert.ok(r.itens.length <= LIMITE_PADRAO);
    assert.ok(r.itens.length > 0);
    assert.strictEqual(new Set(ids(r.itens)).size, r.itens.length);
    assert.ok(r.itens.some((p) => p.nome === 'PICOLE CREMOSO'));
    assert.ok(r.itens.length <= 20);
    assert.ok(r.meta.total_operacional <= 20);
    assert.strictEqual(r.meta.mib_consultado, false);

    const cadastro = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(cadastro.includes('limite=20'));
    assert.ok(!/produtosCache\.filter/.test(cadastro.split('executarBuscaProdutosViaMib')[1].slice(0, 2500)));

    await new Promise((resolve) => db5k.close(() => resolve()));
  });

  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nSprint 04 busca operacional OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
