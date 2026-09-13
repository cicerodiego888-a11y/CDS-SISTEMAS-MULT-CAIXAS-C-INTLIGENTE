/**
 * Auditoria RC3.16.1 — confirmação fiscal de Pedido (Motor Comercial).
 */
'use strict';

const SQL = `
CREATE TABLE IF NOT EXISTS auditoria_pedido_estoque_fiscal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER,
  produto_id INTEGER,
  evento TEXT NOT NULL,
  quantidade REAL,
  saldo_fiscal REAL,
  saldo_nao_fiscal REAL,
  disponivel_fiscal REAL,
  disponivel_nao_fiscal REAL,
  detalhes TEXT,
  usuario_id INTEGER,
  supervisor_id INTEGER,
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
)
`;

const Evento = Object.freeze({
  CONSULTA: 'CONSULTA',
  REQUER_AUTORIZACAO: 'REQUER_AUTORIZACAO',
  AUTORIZACAO_CONCEDIDA: 'AUTORIZACAO_CONCEDIDA',
  AUTORIZACAO_REJEITADA: 'AUTORIZACAO_REJEITADA',
  TRANSFERENCIA: 'TRANSFERENCIA',
  RESERVA: 'RESERVA',
  CONFIRMADO: 'CONFIRMADO',
  BLOQUEADO: 'BLOQUEADO',
  ROLLBACK: 'ROLLBACK',
  // RC5.3.2 … RC5.3.5 — reparo de reserva
  REPARO_LIBERAR_RESERVA: 'REPARO_LIBERAR_RESERVA',
  REPARO_REMOVER_RESERVA: 'REPARO_REMOVER_RESERVA',
  REPARO_CRIAR_RESERVA: 'REPARO_CRIAR_RESERVA',
  REPARO_AJUSTAR_RESERVA: 'REPARO_AJUSTAR_RESERVA'
});

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID });
    });
  });
}

async function garantirSchema(db) {
  await dbRun(db, SQL);
}

async function registrar(db, dados = {}) {
  await garantirSchema(db);
  const r = await dbRun(
    db,
    `INSERT INTO auditoria_pedido_estoque_fiscal (
      pedido_id, produto_id, evento, quantidade,
      saldo_fiscal, saldo_nao_fiscal,
      disponivel_fiscal, disponivel_nao_fiscal,
      detalhes, usuario_id, supervisor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.pedido_id != null ? Number(dados.pedido_id) : null,
      dados.produto_id != null ? Number(dados.produto_id) : null,
      String(dados.evento),
      dados.quantidade != null ? Number(dados.quantidade) : null,
      dados.saldo_fiscal != null ? Number(dados.saldo_fiscal) : null,
      dados.saldo_nao_fiscal != null ? Number(dados.saldo_nao_fiscal) : null,
      dados.disponivel_fiscal != null ? Number(dados.disponivel_fiscal) : null,
      dados.disponivel_nao_fiscal != null ? Number(dados.disponivel_nao_fiscal) : null,
      dados.detalhes != null
        ? (typeof dados.detalhes === 'string' ? dados.detalhes : JSON.stringify(dados.detalhes))
        : null,
      dados.usuario_id != null ? Number(dados.usuario_id) : null,
      dados.supervisor_id != null ? Number(dados.supervisor_id) : null
    ]
  );
  return r.lastID;
}

module.exports = {
  Evento,
  garantirSchema,
  registrar,
  SQL
};
