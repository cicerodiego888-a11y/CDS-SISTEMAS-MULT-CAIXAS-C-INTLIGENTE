'use strict';

const { REL } = require('./relations');

/**
 * Aprende relações a partir do histórico de vendas.
 */
class SalesLearning {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @returns {Promise<{
   *   vendidoJunto: Array<{ a: number, b: number, peso: number }>,
   *   horarios: object,
   *   sazonalidade: object,
   *   porFilial: object
   * }>}
   */
  async analisar(opcoes = {}) {
    const dias = Math.min(Math.max(Number(opcoes.dias) || 90, 7), 365);
    const pares = await this._paresVendidosJunto(dias);
    const horarios = await this._horarios(dias);
    const sazonalidade = await this._sazonalidade(dias);
    const porFilial = await this._porFilial(dias);

    return {
      vendidoJunto: pares,
      horarios,
      sazonalidade,
      porFilial,
      relacao: REL.VENDIDO_JUNTO
    };
  }

  _paresVendidosJunto(dias) {
    return new Promise((resolve) => {
      const sql = `
        SELECT vi1.produto_id AS a, vi2.produto_id AS b, COUNT(*) AS n
        FROM vendas_itens vi1
        INNER JOIN vendas_itens vi2
          ON vi1.venda_id = vi2.venda_id AND vi1.produto_id < vi2.produto_id
        INNER JOIN vendas v ON v.id = vi1.venda_id
        WHERE COALESCE(v.cancelada, 0) = 0
          AND date(v.data_venda) >= date('now', ?)
        GROUP BY vi1.produto_id, vi2.produto_id
        HAVING n >= 1
        ORDER BY n DESC
        LIMIT 2000
      `;
      this.db.all(sql, [`-${dias} day`], (err, rows) => {
        if (err) return resolve([]);
        resolve((rows || []).map((r) => ({
          a: Number(r.a),
          b: Number(r.b),
          peso: Number(r.n) || 1
        })));
      });
    });
  }

  _horarios(dias) {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT CAST(strftime('%H', v.data_venda) AS INTEGER) AS hora,
                vi.produto_id AS produto_id,
                COUNT(*) AS n
         FROM vendas v
         INNER JOIN vendas_itens vi ON vi.venda_id = v.id
         WHERE COALESCE(v.cancelada, 0) = 0
           AND date(v.data_venda) >= date('now', ?)
         GROUP BY hora, vi.produto_id
         ORDER BY n DESC
         LIMIT 500`,
        [`-${dias} day`],
        (err, rows) => {
          if (err) return resolve({});
          const map = {};
          for (const r of rows || []) {
            const h = String(r.hora ?? 'x');
            if (!map[h]) map[h] = [];
            if (map[h].length < 10) {
              map[h].push({ produto_id: r.produto_id, count: r.n });
            }
          }
          resolve(map);
        }
      );
    });
  }

  _sazonalidade(dias) {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT CAST(strftime('%m', v.data_venda) AS INTEGER) AS mes,
                vi.produto_id AS produto_id,
                SUM(vi.quantidade) AS qtd
         FROM vendas v
         INNER JOIN vendas_itens vi ON vi.venda_id = v.id
         WHERE COALESCE(v.cancelada, 0) = 0
           AND date(v.data_venda) >= date('now', ?)
         GROUP BY mes, vi.produto_id
         ORDER BY qtd DESC
         LIMIT 400`,
        [`-${dias} day`],
        (err, rows) => {
          if (err) return resolve({});
          const map = {};
          for (const r of rows || []) {
            const m = String(r.mes ?? 'x');
            if (!map[m]) map[m] = [];
            if (map[m].length < 15) {
              map[m].push({ produto_id: r.produto_id, qtd: r.qtd });
            }
          }
          resolve(map);
        }
      );
    });
  }

  _porFilial(dias) {
    return new Promise((resolve) => {
      // filial_id pode não existir — tenta e falha graciosamente
      this.db.all(
        `SELECT COALESCE(v.filial_id, 0) AS filial_id,
                vi.produto_id AS produto_id,
                SUM(vi.quantidade) AS qtd
         FROM vendas v
         INNER JOIN vendas_itens vi ON vi.venda_id = v.id
         WHERE COALESCE(v.cancelada, 0) = 0
           AND date(v.data_venda) >= date('now', ?)
         GROUP BY filial_id, vi.produto_id
         ORDER BY qtd DESC
         LIMIT 500`,
        [`-${dias} day`],
        (err, rows) => {
          if (err) return resolve({});
          const map = {};
          for (const r of rows || []) {
            const f = String(r.filial_id ?? 0);
            if (!map[f]) map[f] = [];
            if (map[f].length < 20) {
              map[f].push({ produto_id: r.produto_id, qtd: r.qtd });
            }
          }
          resolve(map);
        }
      );
    });
  }
}

module.exports = SalesLearning;
