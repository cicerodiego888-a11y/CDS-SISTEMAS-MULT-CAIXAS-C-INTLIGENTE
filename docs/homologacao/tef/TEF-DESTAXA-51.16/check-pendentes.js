'use strict';
const path = require('path');
const fs = require('fs');

const dbPath = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';
const out = { dbPath, ok: false };

function tryBetter() {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const pendentes = db.prepare(
    "SELECT id, status, valor, tipo, provedor, idempotency_key, criado_em FROM tef_transacoes WHERE status='pendente' ORDER BY id DESC LIMIT 20"
  ).all();
  const count = db.prepare("SELECT COUNT(*) AS n FROM tef_transacoes WHERE status='pendente'").get();
  db.close();
  return { ok: true, engine: 'better-sqlite3', count: count.n, pendentes };
}

function trySqlite3() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const pendentes = db.prepare(
    "SELECT id, status, valor, tipo, provedor, idempotency_key, criado_em FROM tef_transacoes WHERE status='pendente' ORDER BY id DESC LIMIT 20"
  ).all();
  const count = db.prepare("SELECT COUNT(*) AS n FROM tef_transacoes WHERE status='pendente'").get();
  db.close();
  return { ok: true, engine: 'node:sqlite', count: count.n, pendentes };
}

try {
  Object.assign(out, tryBetter());
} catch (e1) {
  try {
    Object.assign(out, trySqlite3());
  } catch (e2) {
    out.error = { better: e1.message, nodeSqlite: e2.message };
  }
}

fs.writeFileSync(path.join(__dirname, 'pendentes.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
