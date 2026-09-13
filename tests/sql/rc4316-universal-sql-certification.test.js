/**
 * RC4.31.6 — Certificação Universal SQL (INSERT, UPDATE, DELETE, SELECT)
 * Executar: node tests/sql/rc4316-universal-sql-certification.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  validateSql,
  validateUpdate,
  validateDelete,
  validateSelect,
  SqlCertificationError,
  aplicarCertificacaoSql,
  gerarRelatorioCertificacao,
  resetRelatorio
} = require('../../backend/lib/sqlCertification');
const { auditarModulos, gerarRelatorioPorModulo } = require('../../backend/lib/scanSqlCertificationInSource');

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

function dbMemoria() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
  });
}

console.log('\n=== RC4.31.6 — Certificação Universal SQL ===\n');

resetRelatorio();

// --- INSERT ---
test('INSERT válido — placeholders alinhados', () => {
  validateSql('INSERT INTO produtos (a, b) VALUES (?, ?)', [1, 2]);
});

test('INSERT inválido — placeholders !== parâmetros', () => {
  assert.throws(
    () => validateSql('INSERT INTO produtos (a, b) VALUES (?, ?)', [1]),
    (err) => err instanceof SqlCertificationError || err.name === 'InsertAlignmentError'
  );
});

// --- UPDATE ---
test('UPDATE válido — SET + WHERE alinhados', () => {
  validateUpdate('UPDATE produtos SET nome = ?, preco = ? WHERE id = ?', ['x', 10, 1]);
});

test('UPDATE inválido — parâmetros insuficientes', () => {
  assert.throws(
    () => validateUpdate('UPDATE produtos SET nome = ? WHERE id = ?', ['x']),
    SqlCertificationError
  );
});

test('UPDATE inválido — colunas duplicadas', () => {
  assert.throws(
    () => validateUpdate('UPDATE produtos SET nome = ?, nome = ? WHERE id = ?', ['a', 'b', 1]),
    SqlCertificationError
  );
});

// --- DELETE ---
test('DELETE com WHERE — permitido', () => {
  validateDelete('DELETE FROM produtos WHERE id = ?', [1]);
});

test('DELETE sem WHERE — bloqueado', () => {
  assert.throws(
    () => validateDelete('DELETE FROM produtos'),
    SqlCertificationError
  );
});

test('DELETE completo — permitido com allow-full-delete', () => {
  validateDelete('DELETE FROM produtos -- allow-full-delete', [], { allowFullDelete: true });
});

// --- SELECT ---
test('SELECT com parâmetros corretos', () => {
  validateSelect('SELECT * FROM produtos WHERE id = ?', [1]);
});

test('SELECT com parâmetros incorretos', () => {
  assert.throws(
    () => validateSelect('SELECT * FROM produtos WHERE id = ? AND ativo = ?', [1]),
    SqlCertificationError
  );
});

test('SELECT com undefined — rejeitado', () => {
  assert.throws(
    () => validateSql('SELECT * FROM produtos WHERE id = ?', [undefined]),
    SqlCertificationError
  );
});

// --- Prepared Statement (runtime) ---
test('Prepared Statement válido', async () => {
  const db = await dbMemoria();
  aplicarCertificacaoSql(db);
  await new Promise((resolve, reject) => {
    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT)', (err) => (err ? reject(err) : resolve()));
  });
  const stmt = db.prepare('INSERT INTO t (nome) VALUES (?)');
  await new Promise((resolve, reject) => {
    stmt.run('abc', function runCb(err) {
      if (err) reject(err);
      else resolve();
    });
  });
  db.close();
});

test('Prepared Statement inválido — bloqueado', async () => {
  const db = await dbMemoria();
  aplicarCertificacaoSql(db);
  await new Promise((resolve, reject) => {
    db.run('CREATE TABLE t2 (id INTEGER PRIMARY KEY, nome TEXT)', (err) => (err ? reject(err) : resolve()));
  });
  const stmt = db.prepare('INSERT INTO t2 (nome) VALUES (?)');
  let bloqueou = false;
  try {
    stmt.run();
  } catch (err) {
    bloqueou = err instanceof SqlCertificationError;
  }
  assert.ok(bloqueou, 'deveria bloquear prepared statement sem parâmetros');
  db.close();
});

// --- Runtime db.run/get/all ---
test('Runtime db.run — intercepta UPDATE inválido', async () => {
  const db = await dbMemoria();
  aplicarCertificacaoSql(db);
  await new Promise((resolve, reject) => {
    db.run('CREATE TABLE t3 (id INTEGER, v TEXT)', (err) => (err ? reject(err) : resolve()));
  });
  let bloqueou = false;
  try {
    db.run('UPDATE t3 SET v = ? WHERE id = ?', ['x']);
  } catch (err) {
    bloqueou = err instanceof SqlCertificationError;
  }
  assert.ok(bloqueou);
  db.close();
});

test('Runtime db.get — intercepta SELECT inválido', async () => {
  const db = await dbMemoria();
  aplicarCertificacaoSql(db);
  let bloqueou = false;
  try {
    db.get('SELECT 1 WHERE ? = ? AND ? = ?', [1]);
  } catch (err) {
    bloqueou = err instanceof SqlCertificationError;
  }
  assert.ok(bloqueou);
  db.close();
});

// --- Auditoria estática RC4.31.6 ---
test('Auditoria estática — módulos críticos sem reprovações', () => {
  const rel = auditarModulos(ROOT);
  const { resumo, reprovados } = gerarRelatorioPorModulo(rel);
  if (reprovados.length) {
    reprovados.forEach((r) => {
      console.error(`       ${r.modulo} ${r.arquivo}:${r.linha} [${r.operacao}] ${r.detalhe}`);
    });
  }
  assert.strictEqual(reprovados.length, 0, `${reprovados.length} SQL(s) reprovado(s) na auditoria estática`);
  assert.ok(rel.length > 0, 'nenhum comando SQL encontrado na auditoria');
  console.log('       Resumo auditoria estática:');
  Object.entries(resumo).forEach(([op, s]) => {
    if (s.auditados > 0) console.log(`         ${op}: ${s.aprovados}/${s.auditados} aprovados`);
  });
});

// --- Relatório de certificação ---
test('Relatório de certificação — estrutura RC4.31.6', () => {
  const rel = gerarRelatorioCertificacao();
  assert.ok(rel.includes('## INSERT'));
  assert.ok(rel.includes('## UPDATE'));
  assert.ok(rel.includes('## DELETE'));
  assert.ok(rel.includes('## SELECT'));
  console.log('\n' + rel);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
