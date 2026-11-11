'use strict';
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database(
  'C:/ProgramData/MercantilFiscal/dados/mercadao.db',
  sqlite3.OPEN_READONLY
);
db.all(
  'SELECT id, username, role, COALESCE(perfil, ?) AS perfil FROM usuarios LIMIT 20',
  ['USUARIO'],
  (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
    db.close();
  }
);
