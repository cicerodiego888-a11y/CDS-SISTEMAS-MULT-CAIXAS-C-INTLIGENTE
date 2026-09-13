/**
 * MUC RC1 — Repositório de histórico de apresentações
 * @module motores/muc/repositorios/RepositorioHistorico
 */
'use strict';

class RepositorioHistorico {
  constructor(db) {
    this.db = db;
  }

  registrarAlteracao(apresentacaoId, campo, valorAnterior, valorNovo, usuario, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    this.db.run(
      `INSERT INTO produto_embalagem_historico (
        embalagem_id, campo, valor_anterior, valor_novo, usuario_id, usuario_nome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [
        apresentacaoId,
        campo,
        valorAnterior != null ? String(valorAnterior) : null,
        valorNovo != null ? String(valorNovo) : null,
        usuario?.id || null,
        usuario?.nome || usuario?.username || null
      ],
      done
    );
  }

  listarPorApresentacao(apresentacaoId, callback) {
    this.db.all(
      `SELECT * FROM produto_embalagem_historico
       WHERE embalagem_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [apresentacaoId],
      callback
    );
  }
}

module.exports = { RepositorioHistorico };
