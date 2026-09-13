/**
 * RC3.6.C — Pesquisa inteligente da Central de Entradas
 * Executar: node tests/central-entradas/rc36c-pesquisa-inteligente.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const {
  normalizarTextoBusca,
  apenasDigitos,
  numeroSemZerosEsquerda,
  montarClausulaBuscaInteligente
} = require('../../backend/motores/central-entradas/utils/normalizarBuscaCentral');
const { CentralDocumentosRepository } = (() => {
  try {
    return { CentralDocumentosRepository: require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository') };
  } catch {
    return { CentralDocumentosRepository: null };
  }
})();

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error('Use testAsync para async');
    }
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

async function testAsync(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function runExec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

console.log('\n=== RC3.6.C — Pesquisa Inteligente ===\n');

test('normaliza CNPJ máscara → dígitos', () => {
  assert.strictEqual(apenasDigitos('35.428.312/0004-28'), '35428312000428');
  assert.strictEqual(apenasDigitos('35428312000428'), '35428312000428');
});

test('normaliza número NF com zeros', () => {
  assert.strictEqual(numeroSemZerosEsquerda('00064706'), '64706');
  assert.strictEqual(numeroSemZerosEsquerda('064706'), '64706');
  assert.strictEqual(numeroSemZerosEsquerda('64706'), '64706');
});

test('normaliza fornecedor &amp; e acentos', () => {
  assert.strictEqual(normalizarTextoBusca('MERCANTE &amp; ROFE'), 'mercante & rofe');
  assert.strictEqual(normalizarTextoBusca('MERCANTE & ROFE'), 'mercante & rofe');
  assert.strictEqual(normalizarTextoBusca('  José   Silva  '), 'jose silva');
});

test('montarClausulaBuscaInteligente gera OR com params', () => {
  const c = montarClausulaBuscaInteligente('35.428.312/0004-28');
  assert.ok(c.sql.includes('OR'));
  assert.ok(c.params.some((p) => String(p).includes('35428312000428')));
  assert.ok(c.meta.digitos === '35428312000428');
});

test('Repository usa montarClausulaBuscaInteligente', () => {
  const src = ler('backend/motores/central-entradas/repositories/CentralDocumentosRepository.js');
  assert.match(src, /montarClausulaBuscaInteligente/);
  assert.match(src, /\[Central Entradas\]\[BUSCA\]/);
  assert.doesNotMatch(src, /chave LIKE \? OR numero LIKE \? OR fornecedor LIKE \? OR cnpj_fornecedor LIKE \?/);
});

test('Frontend indica filtros ativos e empty inteligente', () => {
  const fe = ler('frontend/erp/js/central-entradas.js');
  const ux = ler('frontend/erp/js/central-entradas-ux.js');
  assert.match(fe, /renderIndicadorFiltrosAtivosCentral/);
  assert.match(fe, /limparFiltrosRestritivosManterBuscaCentral/);
  assert.match(fe, /centralFiltrosAtivosWrap/);
  assert.match(fe, /A pesquisa está considerando os filtros ativos/);
  assert.match(ux, /pesquisa_filtros/);
  assert.match(ux, /Limpar filtros e pesquisar novamente/);
});

(async () => {
  await testAsync('SQLite: CNPJ máscara ≡ dígitos; & ≡ &amp;; zeros NF', async () => {
    const db = new sqlite3.Database(':memory:');
    await runExec(db, `
      CREATE TABLE central_entradas_documentos (
        id INTEGER PRIMARY KEY,
        chave TEXT,
        numero TEXT,
        fornecedor TEXT,
        cnpj_fornecedor TEXT,
        status TEXT,
        data_emissao TEXT
      );
      INSERT INTO central_entradas_documentos VALUES
        (33, '23260735428312000428550030000647061103244212', '64706',
         'MERCANTE &amp; ROFE DISTRIBUIDORA LTDA - CE', '35428312000428',
         'EM_COMPRA', '2026-07-27');
    `);

    async function buscar(termo) {
      const c = montarClausulaBuscaInteligente(termo);
      const rows = await runSql(
        db,
        `SELECT id FROM central_entradas_documentos WHERE ${c.sql}`,
        c.params
      );
      return rows.map((r) => r.id);
    }

    assert.deepStrictEqual(await buscar('64706'), [33]);
    assert.deepStrictEqual(await buscar('064706'), [33]);
    assert.deepStrictEqual(await buscar('00064706'), [33]);
    assert.deepStrictEqual(await buscar('35.428.312/0004-28'), [33]);
    assert.deepStrictEqual(await buscar('35428312000428'), [33]);
    assert.deepStrictEqual(await buscar('MERCANTE & ROFE'), [33]);
    assert.deepStrictEqual(await buscar('MERCANTE &amp; ROFE'), [33]);
    assert.deepStrictEqual(await buscar('23260735428312000428550030000647061103244212'), [33]);

    const repo = new CentralDocumentosRepository({ db: null });
    // usa _montarClausulaWhere sem abrir DB real
    const whereHoje = repo._montarClausulaWhere({ busca: '64706', filtroRapido: 'hoje' });
    assert.match(whereHoje.clausulaWhere, /date\(data_emissao\) = date\('now'/);
    assert.ok(whereHoje.params.length > 0);

    const wherePuro = repo._montarClausulaWhere({ busca: '64706' });
    assert.ok(wherePuro.clausulaWhere.includes('OR'));
    assert.doesNotMatch(wherePuro.clausulaWhere, /filtro|hoje/i);

    await new Promise((resolve) => db.close(resolve));
  });

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
})();
