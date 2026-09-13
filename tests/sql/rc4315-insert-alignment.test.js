/**
 * RC4.31.5 — Certificação automática de alinhamento SQL INSERT
 * Executar: node tests/sql/rc4315-insert-alignment.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const {
  validateInsertAlignment,
  analisarInsertSql,
  InsertAlignmentError,
  TABELAS_MONITORADAS
} = require('../../backend/lib/validateInsertAlignment');
const { auditarModulos } = require('../../backend/lib/scanInsertAlignmentInSource');

const ROOT = path.join(__dirname, '../..');

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

console.log('\n=== RC4.31.5 — Validação INSERT SQL ===\n');

test('validateInsertAlignment — compras 48 colunas alinhadas', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  const m = src.match(/INSERT INTO compras \(\s*([\s\S]*?)\) VALUES \(([\s\S]*?)\)\s*`, \[([\s\S]*?)\], function\(err\)/);
  assert.ok(m);
  const sql = `INSERT INTO compras (${m[1]}) VALUES (${m[2]})`;
  const arrLines = m[3].split('\n').filter((l) => {
    const t = l.trim();
    return t && t !== ',' && !t.startsWith('//');
  });
  validateInsertAlignment(sql, new Array(arrLines.length).fill(null));
});

test('validateInsertAlignment — rejeita desalinhamento', () => {
  assert.throws(() => {
    validateInsertAlignment(
      'INSERT INTO compras (a, b, c) VALUES (?, ?, ?)',
      [1, 2]
    );
  }, InsertAlignmentError);
});

test('validateInsertAlignment — literais fixos contam como slots', () => {
  const r = validateInsertAlignment(
    "INSERT INTO compras (a, b, status) VALUES (?, ?, 'concluida')",
    [1, 2]
  );
  assert.strictEqual(r.colunas, 3);
  assert.strictEqual(r.placeholders, 2);
  assert.strictEqual(r.literais, 1);
});

test('analisarInsertSql — datetime como literal único', () => {
  const a = analisarInsertSql(
    "INSERT INTO produtos (id, criado) VALUES (?, datetime('now', 'localtime'))"
  );
  assert.strictEqual(a.slots, 2);
  assert.strictEqual(a.placeholders, 1);
  assert.strictEqual(a.literais, 1);
});

test('TABELAS_MONITORADAS inclui módulos RC4.31.5', () => {
  ['compras', 'compras_itens', 'financeiro', 'produtos', 'vendas', 'pedidos', 'nfce_notas', 'nfe_notas'].forEach((t) => {
    assert.ok(TABELAS_MONITORADAS.includes(t), `falta tabela ${t}`);
  });
});

test('validateInsertAlignment — INSERT produtos dinâmico (37 colunas)', () => {
  const sql = `INSERT INTO produtos (${Array.from({ length: 37 }, (_, i) => `c${i}`).join(', ')}) VALUES (${Array(37).fill('?').join(', ')})`;
  validateInsertAlignment(sql, new Array(37).fill(null));
});

test('Auditoria estática — nenhum INSERT monitorado desalinhado', () => {
  const rel = auditarModulos(ROOT);
  const ruins = rel.filter((r) => r.ok === false);
  if (ruins.length) {
    ruins.forEach((r) => {
      console.error(`       ${r.arquivo} [${r.tabela}] col=${r.colunas} slots=${r.slots}`);
    });
  }
  assert.strictEqual(ruins.length, 0, `${ruins.length} INSERT(s) desalinhado(s) na auditoria estática`);
  assert.ok(rel.length > 0, 'nenhum INSERT monitorado encontrado');
  console.log(`       (${rel.length} INSERT(s) monitorados verificados)`);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
