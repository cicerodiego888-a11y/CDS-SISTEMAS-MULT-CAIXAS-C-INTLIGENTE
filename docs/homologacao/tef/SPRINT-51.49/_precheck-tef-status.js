'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const rows = db.prepare('SELECT id, status, payload_retorno FROM tef_transacoes ORDER BY id').all();
const mapped = rows.map((r) => {
  let fs = null;
  try {
    const p = r.payload_retorno ? JSON.parse(r.payload_retorno) : null;
    fs = p?.financialState || p?.resultadoTardio?.financialState || null;
  } catch (_) {
    fs = 'PARSE_ERROR';
  }
  return { id: r.id, status: r.status, financialState: fs };
});
const unknown = mapped.filter((r) =>
  String(r.financialState || '').toUpperCase() === 'UNKNOWN'
  || String(r.status || '').toLowerCase() === 'unknown'
  || String(r.status || '').toLowerCase() === 'pendente'
);
db.close();
console.log(JSON.stringify({ rows: mapped, unknown, ok: unknown.length === 0 }, null, 2));
