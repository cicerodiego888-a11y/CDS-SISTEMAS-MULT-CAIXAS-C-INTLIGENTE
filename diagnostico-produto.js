const sqlite3 = require('sqlite3');

const db = new sqlite3.Database(
  'C:/ProgramData/MercantilFiscal/dados/mercadao.db',
  sqlite3.OPEN_READONLY
);

db.all(`
  SELECT
    id,
    nome,
    quantidade,
    estoque_atual,
    saldo_fiscal,
    saldo_nao_fiscal,
    item_fiscal,
    controla_estoque
  FROM produtos
  WHERE id = 611
`, (err, rows) => {
  if (err) {
    console.error(err.message);
    return db.close();
  }

  console.table(rows);
  db.close();
});
