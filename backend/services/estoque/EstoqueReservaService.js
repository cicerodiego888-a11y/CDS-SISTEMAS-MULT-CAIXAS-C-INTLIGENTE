/**
 * Reserva de estoque para Vendas para Entrega (Sprint 2)
 * NÃO baixa saldo_fiscal / saldo_nao_fiscal / estoque_atual.
 * Apenas incrementa reservado_* e grava venda_estoque_reservas.
 */

'use strict';

const db = require('../../database');
const { produtoControlaEstoque } = require('./produtoControlaEstoque');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Incrementa reserva no produto e registra linha da reserva.
 * Deve ser chamado DENTRO de uma transação já aberta pelo caller quando possível.
 */
function reservarItem({
  vendaId,
  vendaItemId,
  produtoId,
  quantidadeFiscal,
  quantidadeNaoFiscal
}, callback) {
  const qF = Number(quantidadeFiscal || 0);
  const qNf = Number(quantidadeNaoFiscal || 0);

  if (qF <= 0 && qNf <= 0) {
    return callback(null);
  }

  db.get(
    `SELECT COALESCE(controla_estoque, 1) AS controla_estoque FROM produtos WHERE id = ?`,
    [produtoId],
    (errFlag, rowFlag) => {
      if (errFlag) return callback(errFlag);
      if (!produtoControlaEstoque(rowFlag || {})) {
        return callback(null);
      }

      db.run(
        `
          UPDATE produtos
          SET
            reservado_fiscal = COALESCE(reservado_fiscal, 0) + ?,
            reservado_nao_fiscal = COALESCE(reservado_nao_fiscal, 0) + ?
          WHERE id = ?
        `,
        [qF, qNf, produtoId],
        (errUpdate) => {
          if (errUpdate) return callback(errUpdate);

          db.run(
            `
              INSERT INTO venda_estoque_reservas (
                venda_id, venda_item_id, produto_id,
                quantidade_fiscal, quantidade_nao_fiscal,
                status, criado_em
              ) VALUES (?, ?, ?, ?, ?, 'ATIVA', CURRENT_TIMESTAMP)
            `,
            [vendaId, vendaItemId || null, produtoId, qF, qNf],
            callback
          );
        }
      );
    }
  );
}

/**
 * Libera reservas ativas de uma venda (cancelamento futuro / Sprint 3).
 */
async function liberarReservasDaVenda(vendaId) {
  const rows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM venda_estoque_reservas WHERE venda_id = ? AND status = 'ATIVA'`,
      [vendaId],
      (err, list) => (err ? reject(err) : resolve(list || []))
    );
  });

  for (const row of rows) {
    await run(
      `
        UPDATE produtos
        SET
          reservado_fiscal = CASE
            WHEN COALESCE(reservado_fiscal, 0) - ? < 0 THEN 0
            ELSE COALESCE(reservado_fiscal, 0) - ?
          END,
          reservado_nao_fiscal = CASE
            WHEN COALESCE(reservado_nao_fiscal, 0) - ? < 0 THEN 0
            ELSE COALESCE(reservado_nao_fiscal, 0) - ?
          END
        WHERE id = ?
      `,
      [
        Number(row.quantidade_fiscal || 0),
        Number(row.quantidade_fiscal || 0),
        Number(row.quantidade_nao_fiscal || 0),
        Number(row.quantidade_nao_fiscal || 0),
        row.produto_id
      ]
    );
    await run(
      `UPDATE venda_estoque_reservas SET status = 'CANCELADA', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      [row.id]
    );
  }

  return { liberadas: rows.length };
}

function obterProdutoComReserva(produtoId, callback) {
  db.get(
    `
      SELECT
        id, nome, estoque_atual,
        COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
        COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
        COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
        COALESCE(reservado_nao_fiscal, 0) AS reservado_nao_fiscal
      FROM produtos
      WHERE id = ?
    `,
    [produtoId],
    callback
  );
}

module.exports = {
  reservarItem,
  liberarReservasDaVenda,
  obterProdutoComReserva,
  run,
  get
};
