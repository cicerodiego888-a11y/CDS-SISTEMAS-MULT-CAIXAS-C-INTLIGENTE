'use strict';
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

(async () => {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  try {
    const out = { dbPath };
    out.caixaSessoesCols = await all(db, 'PRAGMA table_info(caixa_sessoes)');
    out.sessoesRecentes = await all(db, 'SELECT * FROM caixa_sessoes ORDER BY id DESC LIMIT 5');
    out.caixasCols = await all(db, 'PRAGMA table_info(caixas)').catch(() => []);
    out.caixas = await all(db, 'SELECT * FROM caixas LIMIT 10').catch((e) => ({ error: e.message }));
    out.produtoCols = await all(db, 'PRAGMA table_info(produtos)');
    const colNames = out.produtoCols.map((c) => c.name);
    const precoCol = ['preco_venda', 'preco', 'valor_venda', 'preco_varejo'].find((c) => colNames.includes(c));
    out.precoCol = precoCol || null;
    if (precoCol) {
      out.produtos1real = await all(db, `
        SELECT id, ${colNames.includes('codigo') ? 'codigo,' : ''} ${colNames.includes('nome') ? 'nome,' : ''} ${colNames.includes('descricao') ? 'descricao,' : ''} ${precoCol} AS preco
        FROM produtos
        WHERE ABS(COALESCE(${precoCol}, 0) - 1.0) < 0.001
        LIMIT 20`);
      out.produtosBaratos = await all(db, `
        SELECT id, ${colNames.includes('codigo') ? 'codigo,' : ''} ${colNames.includes('nome') ? 'nome,' : ''} ${precoCol} AS preco
        FROM produtos
        WHERE COALESCE(${precoCol}, 0) > 0 AND COALESCE(${precoCol}, 0) <= 2.0
        ORDER BY ${precoCol} ASC
        LIMIT 20`);
    }
    out.vendasCols = await all(db, 'PRAGMA table_info(vendas)');
    out.vendasRecentes = await all(db, 'SELECT * FROM vendas ORDER BY id DESC LIMIT 3');
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
