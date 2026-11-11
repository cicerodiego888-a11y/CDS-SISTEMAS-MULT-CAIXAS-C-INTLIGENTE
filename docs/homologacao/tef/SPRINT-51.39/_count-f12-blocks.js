'use strict';
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database(
  'C:/ProgramData/MercantilFiscal/dados/mercadao.db',
  sqlite3.OPEN_READONLY
);
db.all(
  `SELECT evento, detalhes, COUNT(*) AS qtd
   FROM licenca_logs
   WHERE detalhes LIKE '%/api/f12%'
      OR (evento LIKE '%vencida%' AND detalhes LIKE '%f12%')
   GROUP BY evento, detalhes
   ORDER BY qtd DESC
   LIMIT 20`,
  (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
    db.close();
  }
);
