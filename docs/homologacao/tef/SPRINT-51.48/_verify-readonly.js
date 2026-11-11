'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const cols = db.prepare("PRAGMA table_info(tef_transacoes)").all().map((c) => c.name);
const compCols = cols.filter((n) => /comprovante/i.test(n));
const tx3 = db.prepare('SELECT * FROM tef_transacoes WHERE id = 3').get();
const tx2 = db.prepare('SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 2').get();
const venda = db.prepare('SELECT id, total, status, status_pagamento, tef_transacao_id FROM vendas WHERE id = 66').get();
const max = db.prepare('SELECT MAX(id) AS maxId, COUNT(*) AS total FROM tef_transacoes').get();
const pendentes = db.prepare("SELECT id, status FROM tef_transacoes WHERE status='pendente'").all();
const comprovantes = {};
for (const col of compCols) {
  const v = tx3 ? tx3[col] : null;
  comprovantes[col] = v == null ? null : String(v).length;
}
db.close();
console.log(JSON.stringify({
  tx3: tx3 ? {
    id: tx3.id,
    status: tx3.status,
    nsu: tx3.nsu,
    autorizacao: tx3.autorizacao,
    venda_id: tx3.venda_id,
    valor: tx3.valor,
    idempotency_key: tx3.idempotency_key
  } : null,
  comprovantes,
  tx2,
  venda,
  max,
  pendentes
}, null, 2));
