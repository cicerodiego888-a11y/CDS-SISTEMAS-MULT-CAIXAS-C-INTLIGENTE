/**
 * RC4.31.4 — Alinhamento INSERT compras (48 colunas = 47 ? + status literal)
 * Executar: node tests/compras/rc4314-insert-compras-alignment.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');

function extrairInsertCompras() {
  const re = /INSERT INTO compras \(\s*([\s\S]*?)\) VALUES \(([\s\S]*?)\)\s*`, \[([\s\S]*?)\], function\(err\)/m;
  const m = SRC.match(re);
  assert.ok(m, 'INSERT compras não encontrado');
  const cols = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  const valsClause = m[2];
  const ph = (valsClause.match(/\?/g) || []).length;
  const lit = (valsClause.match(/'[^']*'/g) || []).length;
  const arrSrc = m[3];
  const arrCount = arrSrc.split('\n').filter((l) => {
    const t = l.trim();
    return t && t !== ',' && !t.startsWith('//');
  }).length;
  return { cols, ph, lit, total: ph + lit, arrCount, valsClause };
}

function extrairInsertItens() {
  const re = /INSERT INTO compras_itens \(\s*([\s\S]*?)\) VALUES \(([\s\S]*?)\)\s*`, \[/m;
  const m = SRC.match(re);
  assert.ok(m, 'INSERT compras_itens não encontrado');
  const cols = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  const ph = (m[2].match(/\?/g) || []).length;
  return { cols, ph };
}

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

console.log('\n=== RC4.31.4 — INSERT compras alinhamento ===\n');

test('INSERT compras — 48 colunas = 47 placeholders + 1 literal (status)', () => {
  const ins = extrairInsertCompras();
  assert.strictEqual(ins.cols.length, 48);
  assert.strictEqual(ins.ph, 47);
  assert.strictEqual(ins.lit, 1);
  assert.strictEqual(ins.total, ins.cols.length);
  assert.strictEqual(ins.arrCount, 47, 'array de valores deve ter 47 elementos');
});

test('INSERT compras — última coluna escrituracao_motivo possui placeholder', () => {
  const ins = extrairInsertCompras();
  assert.strictEqual(ins.cols[ins.cols.length - 1], 'escrituracao_motivo');
  const afterStatus = ins.valsClause.split("'concluida'")[1] || '';
  const phAfter = (afterStatus.match(/\?/g) || []).length;
  assert.strictEqual(phAfter, 27, '27 placeholders após status (condicao_pagamento → escrituracao_motivo)');
});

test('INSERT compras_itens — 36 colunas = 36 placeholders', () => {
  const ins = extrairInsertItens();
  assert.strictEqual(ins.cols.length, 36);
  assert.strictEqual(ins.ph, 36);
  assert.ok(ins.cols.includes('cfop'), 'coluna cfop');
  assert.ok(ins.cols.includes('tipo_fiscal_item'), 'coluna tipo_fiscal_item');
  assert.ok(ins.cols.includes('bonificacao'), 'coluna bonificacao');
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
