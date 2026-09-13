'use strict';

/**
 * Auditoria do CIA — pergunta, plano, motores, tempo, resultado (sem dados sensíveis).
 * Persistência é infraestrutura do agente, não consulta de negócio.
 */
class AgentAudit {
  /**
   * @param {import('sqlite3').Database|null} db
   */
  constructor(db = null) {
    this.db = db;
    this._mem = [];
  }

  async garantirTabela() {
    if (!this.db) return;
    return new Promise((resolve) => {
      this.db.run(
        `CREATE TABLE IF NOT EXISTS cia_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operador_id INTEGER,
          filial_id INTEGER,
          intent TEXT,
          pergunta TEXT,
          plano TEXT,
          motores TEXT,
          tempo_ms REAL,
          ok INTEGER DEFAULT 1,
          resultado_resumo TEXT,
          permissao TEXT,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        () => resolve()
      );
    });
  }

  /**
   * @param {object} evt
   */
  async registrar(evt = {}) {
    const row = {
      operador_id: evt.operador_id != null ? Number(evt.operador_id) : null,
      filial_id: evt.filial_id != null ? Number(evt.filial_id) : null,
      intent: evt.intent || null,
      pergunta: String(evt.pergunta || '').slice(0, 300),
      plano: JSON.stringify({
        steps: (evt.plano?.steps || []).map((s) => s.tool),
        critica: evt.plano?.critica
      }),
      motores: JSON.stringify(evt.motores || []),
      tempo_ms: Number(evt.tempo_ms) || 0,
      ok: evt.ok === false ? 0 : 1,
      resultado_resumo: String(evt.resultado_resumo || '').slice(0, 400),
      permissao: evt.permissao || null
    };

    this._mem.unshift(row);
    if (this._mem.length > 300) this._mem.length = 300;

    if (!this.db) return row;
    await this.garantirTabela();
    await new Promise((resolve) => {
      this.db.run(
        `INSERT INTO cia_audit (
          operador_id, filial_id, intent, pergunta, plano, motores,
          tempo_ms, ok, resultado_resumo, permissao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.operador_id, row.filial_id, row.intent, row.pergunta, row.plano,
          row.motores, row.tempo_ms, row.ok, row.resultado_resumo, row.permissao
        ],
        () => resolve()
      );
    });
    return row;
  }

  async history(limite = 30) {
    if (!this.db) return this._mem.slice(0, limite);
    await this.garantirTabela();
    return new Promise((resolve) => {
      this.db.all(
        `SELECT id, operador_id, filial_id, intent, pergunta, motores, tempo_ms, ok, resultado_resumo, criado_em
         FROM cia_audit ORDER BY id DESC LIMIT ?`,
        [limite],
        (err, rows) => resolve(err ? this._mem.slice(0, limite) : (rows || []))
      );
    });
  }
}

module.exports = AgentAudit;
