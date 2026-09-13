/**
 * Persistência exclusiva da auditoria do MTS.
 * Somente tabela movimentos_transferencia_saldos.
 */
'use strict';

const { ResultadoTransferencia } = require('./contracts');

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function registrarMovimento(db, dados) {
  const resultado = dados.resultado || ResultadoTransferencia.SUCESSO;
  const run = await dbRun(
    db,
    `INSERT INTO movimentos_transferencia_saldos (
      produto_id, origem, destino, quantidade,
      saldo_origem_antes, saldo_origem_depois,
      saldo_destino_antes, saldo_destino_depois,
      motivo, usuario_id, resultado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.produto_id,
      dados.origem,
      dados.destino,
      dados.quantidade,
      dados.saldo_origem_antes,
      dados.saldo_origem_depois,
      dados.saldo_destino_antes,
      dados.saldo_destino_depois,
      dados.motivo != null ? String(dados.motivo) : null,
      dados.usuario_id != null ? Number(dados.usuario_id) : null,
      resultado
    ]
  );
  return { id: run.lastID, ...dados, resultado };
}

async function buscarPorId(db, id) {
  return dbGet(
    db,
    `SELECT * FROM movimentos_transferencia_saldos WHERE id = ?`,
    [Number(id)]
  );
}

module.exports = {
  registrarMovimento,
  buscarPorId
};
