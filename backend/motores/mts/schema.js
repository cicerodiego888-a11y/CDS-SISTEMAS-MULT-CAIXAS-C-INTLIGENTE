/**
 * Schema próprio do MTS — tabela de auditoria.
 * Não toca em produtos/estoque.
 */
'use strict';

const SQL_CREATE = `
CREATE TABLE IF NOT EXISTS movimentos_transferencia_saldos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  origem TEXT NOT NULL,
  destino TEXT NOT NULL,
  quantidade REAL NOT NULL,
  saldo_origem_antes REAL NOT NULL,
  saldo_origem_depois REAL NOT NULL,
  saldo_destino_antes REAL NOT NULL,
  saldo_destino_depois REAL NOT NULL,
  motivo TEXT,
  usuario_id INTEGER,
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  resultado TEXT NOT NULL
)
`;

function garantirSchema(db, callback) {
  if (typeof callback === 'function') {
    db.run(SQL_CREATE, (err) => callback(err || null));
    return;
  }
  return new Promise((resolve, reject) => {
    db.run(SQL_CREATE, (err) => (err ? reject(err) : resolve()));
  });
}

module.exports = {
  SQL_CREATE,
  garantirSchema
};
