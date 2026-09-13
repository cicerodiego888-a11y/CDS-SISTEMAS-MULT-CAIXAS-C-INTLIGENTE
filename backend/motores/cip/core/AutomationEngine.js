'use strict';

/**
 * Automation Engine — materializa ações quando regras são satisfeitas.
 * Persistência leve em cip_automacoes (tarefas/alertas sugeridos).
 */
class AutomationEngine {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._mem = [];
  }

  async garantirTabela() {
    return new Promise((resolve) => {
      this.db.run(
        `CREATE TABLE IF NOT EXISTS cip_automacoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT,
          titulo TEXT,
          mensagem TEXT,
          severidade TEXT,
          acao TEXT,
          payload TEXT,
          status TEXT DEFAULT 'pendente',
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        () => resolve()
      );
    });
  }

  /**
   * @param {object[]} decisoes — saída de regras / decision engine
   * @param {{ dryRun?: boolean }} [opcoes]
   */
  async executar(decisoes = [], opcoes = {}) {
    await this.garantirTabela();
    const acoes = [];
    for (const d of decisoes) {
      const acao = d.acaoSugerida || 'criar_alerta';
      const item = {
        tipo: d.tipo || 'alerta',
        titulo: d.titulo || 'Automação CIP',
        mensagem: d.mensagem || '',
        severidade: d.severidade || 'media',
        acao,
        status: opcoes.dryRun ? 'simulado' : 'pendente',
        payload: {
          regra: d.regra,
          produto_id: d.produto_id || null,
          origemMotor: d.origemMotor || 'CIP'
        }
      };
      acoes.push(item);
      this._mem.unshift(item);
      if (!opcoes.dryRun) {
        await this._persist(item);
      }
    }
    if (this._mem.length > 200) this._mem.length = 200;
    return { ok: true, executadas: acoes.length, acoes: acoes.slice(0, 50) };
  }

  _persist(item) {
    return new Promise((resolve) => {
      this.db.run(
        `INSERT INTO cip_automacoes (tipo, titulo, mensagem, severidade, acao, payload, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          item.tipo,
          item.titulo,
          item.mensagem,
          item.severidade,
          item.acao,
          JSON.stringify(item.payload || {}),
          item.status
        ],
        () => resolve()
      );
    });
  }

  async listar(limite = 30) {
    await this.garantirTabela();
    return new Promise((resolve) => {
      this.db.all(
        `SELECT * FROM cip_automacoes ORDER BY id DESC LIMIT ?`,
        [limite],
        (err, rows) => {
          if (err || !rows?.length) return resolve(this._mem.slice(0, limite));
          resolve(rows);
        }
      );
    });
  }
}

module.exports = AutomationEngine;
