'use strict';
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('C:/ProgramData/MercantilFiscal/dados/mercadao.db', sqlite3.OPEN_READONLY);
db.all(
  `SELECT id, status, valor, idempotency_key, criado_em
   FROM tef_transacoes
   WHERE idempotency_key LIKE 'tef-segunda%' OR id > 2
   ORDER BY id DESC LIMIT 5`,
  (e, r) => {
    if (e) console.error(e);
    else console.log(JSON.stringify(r, null, 2));
    db.close();
  }
);
