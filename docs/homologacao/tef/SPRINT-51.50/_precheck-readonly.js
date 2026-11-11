'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });

const tx = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, valor, idempotency_key
  FROM tef_transacoes WHERE id IN (2,3) ORDER BY id
`).all();
const tx3 = db.prepare('SELECT * FROM tef_transacoes WHERE id = 3').get();
const cols = db.prepare('PRAGMA table_info(tef_transacoes)').all().map((c) => c.name);
const comp = {};
for (const c of cols.filter((n) => /comprovante/i.test(n))) {
  comp[c] = tx3 && tx3[c] != null ? String(tx3[c]).length : null;
}
const venda = db.prepare(`
  SELECT id, total, status, status_pagamento, tef_transacao_id, forma_pagamento
  FROM vendas WHERE id = 66
`).get();
const max = db.prepare('SELECT MAX(id) AS maxId, COUNT(*) AS total FROM tef_transacoes').get();
const pendentes = db.prepare("SELECT id, status FROM tef_transacoes WHERE status='pendente'").all();
const rows = db.prepare('SELECT id, status, payload_retorno FROM tef_transacoes ORDER BY id').all().map((r) => {
  let fs = null;
  try {
    const p = r.payload_retorno ? JSON.parse(r.payload_retorno) : null;
    fs = p?.financialState || p?.resultadoTardio?.financialState || null;
  } catch (_) {
    fs = null;
  }
  return { id: r.id, status: r.status, financialState: fs };
});
const unknown = rows.filter((r) =>
  String(r.financialState || '').toUpperCase() === 'UNKNOWN'
  || String(r.status || '').toLowerCase() === 'unknown'
  || String(r.status || '').toLowerCase() === 'pendente'
);

let tefCfg = null;
try {
  tefCfg = db.prepare(`
    SELECT id, habilitado, provedor, ambiente, pinpad_habilitado, pinpad_porta, pinpad_modelo, pinpad_fabricante
    FROM tef_configuracao ORDER BY id DESC LIMIT 1
  `).get();
} catch (_) {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tef%'").all();
    tefCfg = { erroSchema: true, tables };
  } catch (e2) {
    tefCfg = { erro: e2.message };
  }
}

db.close();
console.log(JSON.stringify({
  tx, venda, max, pendentes, unknown, comprovantes: comp, tefCfg, rows
}, null, 2));
