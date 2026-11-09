'use strict';

const fs = require('fs');
const path = require('path');

const candidates = [
  'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db',
  path.resolve(__dirname, '..', '..', '..', '..', 'dados', 'mercadao.db')
];

let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  console.log(JSON.stringify({ ok: false, erro: 'better-sqlite3 ausente' }));
  process.exit(0);
}

const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) {
  console.log(JSON.stringify({ ok: false, erro: 'db ausente', candidates }));
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const cols = db.prepare('PRAGMA table_info(produtos)').all().map((c) => c.name);
const precoCol = ['preco_venda', 'preco', 'valor_venda', 'preco_varejo'].find((c) => cols.includes(c));
const codigoCol = ['codigo_barras', 'ean', 'gtin'].find((c) => cols.includes(c));
const internoCol = ['codigo_interno', 'codigo', 'sku'].find((c) => cols.includes(c));
const nomeCol = ['nome', 'descricao', 'produto'].find((c) => cols.includes(c));

if (!precoCol) {
  console.log(JSON.stringify({ ok: false, erro: 'coluna preco ausente', cols: cols.slice(0, 40) }));
  db.close();
  process.exit(0);
}

const sql = `
  SELECT id,
         ${codigoCol || 'NULL'} AS codigo_barras,
         ${internoCol || 'NULL'} AS codigo_interno,
         ${nomeCol || 'NULL'} AS nome,
         ${precoCol} AS preco_venda
  FROM produtos
  WHERE CAST(${precoCol} AS REAL) = 1.0
  LIMIT 20
`;
const rows = db.prepare(sql).all();
db.close();
console.log(JSON.stringify({ ok: true, dbPath, precoCol, rows }, null, 2));
