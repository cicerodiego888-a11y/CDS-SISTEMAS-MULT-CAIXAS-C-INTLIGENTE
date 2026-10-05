const sqlite3 = require('sqlite3');

const db = new sqlite3.Database(
  'C:/ProgramData/MercantilFiscal/dados/mercadao.db',
  sqlite3.OPEN_READONLY
);

db.all(`
  SELECT
    id,
    venda_id,
    produto_id,
    quantidade,
    quantidade_fiscal,
    quantidade_nao_fiscal,
    valor_fiscal,
    valor_nao_fiscal
  FROM vendas_itens
  WHERE venda_id IN (18,19,20,21)
  ORDER BY venda_id, id
`, (err, rows) => {
  if (err) {
    console.error(err.message);
    return db.close();
  }

  console.table(rows);
  db.close();
});
