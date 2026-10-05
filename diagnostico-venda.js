const sqlite3 = require('sqlite3');

const caminho = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';

const db = new sqlite3.Database(
  caminho,
  sqlite3.OPEN_READONLY,
  (err) => {
    if (err) {
      console.error('ERRO AO ABRIR:', err.message);
      process.exit(1);
    }

    console.log('Banco aberto em modo SOMENTE LEITURA.\n');

    const sql = `
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
      ORDER BY id DESC
      LIMIT 10
    `;

    db.all(sql, (err, rows) => {
      if (err) {
        console.error('ERRO NA CONSULTA:', err.message);
        db.close();
        process.exit(1);
      }

      console.table(rows);

      db.close(() => {
        console.log('\nConsulta finalizada.');
      });
    });
  }
);
