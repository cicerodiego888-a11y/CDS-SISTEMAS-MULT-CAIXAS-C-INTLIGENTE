'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const keyPath = 'C:/ProgramData/MercantilFiscal/dados/.tef-signing-key.v1';
const markerPath = path.join(
  process.env.APPDATA || '',
  'cds-sistemas-erp',
  '.cds-tef-crypto-context.json'
);

const out = {
  dbPath,
  keyExists: fs.existsSync(keyPath),
  keyBytes: fs.existsSync(keyPath) ? fs.statSync(keyPath).size : null,
  keyMtime: fs.existsSync(keyPath) ? fs.statSync(keyPath).mtime.toISOString() : null,
  markerExists: fs.existsSync(markerPath)
};

if (out.keyExists) {
  try {
    const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    out.keyMeta = {
      versao: raw.versao || null,
      algoritmo: raw.algoritmo || null,
      hasCiphertext: typeof raw.ciphertext === 'string' && raw.ciphertext.length > 0,
      fields: Object.keys(raw)
    };
  } catch (error) {
    out.keyMeta = { parseError: error.message };
  }
}

if (out.markerExists) {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    out.markerMeta = {
      versao: m.versao,
      modo: m.modo || null,
      modulo: m.modulo,
      localStateOrigemSha256: m.localStateOrigemSha256 || null,
      provisionadoEm: m.provisionadoEm || null
    };
  } catch (error) {
    out.markerMeta = { parseError: error.message };
  }
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tef%' ORDER BY name")
  .all()
  .map((t) => t.name);
out.tefTables = tables;

for (const t of tables) {
  try {
    out[`count_${t}`] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
  } catch (error) {
    out[`count_${t}`] = { erro: error.message };
  }
}

try {
  out.maxTef = db.prepare('SELECT MAX(id) AS maxId, COUNT(*) AS c FROM tef_transacoes').get();
} catch (error) {
  out.maxTef = { erro: error.message };
}

db.close();
fs.writeFileSync(
  path.join(__dirname, 'diag-banco-novo-chave.json'),
  `${JSON.stringify(out, null, 2)}\n`
);
console.log(JSON.stringify(out, null, 2));
