'use strict';

const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';
const out = {
  coletadoEm: new Date().toISOString(),
  dbPath,
  ok: false
};

try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const id1 = db.prepare(`
    SELECT id, status, valor, tipo, provedor, nsu, autorizacao,
           idempotency_key, venda_id, criado_em, atualizado_em
    FROM tef_transacoes WHERE id = 1
  `).get();
  const pendentes = db.prepare(`
    SELECT id, status, valor, tipo, provedor, idempotency_key, criado_em
    FROM tef_transacoes WHERE status = 'pendente' ORDER BY id
  `).all();
  db.close();
  out.ok = true;
  out.engine = 'node:sqlite';
  out.id1 = id1 || null;
  out.pendentesCount = pendentes.length;
  out.pendentes = pendentes;
} catch (error) {
  out.error = String(error.message || error);
}

const outPath = path.join(__dirname, 'db-readonly-id1.json');
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
