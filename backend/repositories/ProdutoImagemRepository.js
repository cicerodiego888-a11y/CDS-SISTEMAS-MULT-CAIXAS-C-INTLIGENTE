/**
 * ProdutoImagemRepository — persistência da galeria produto_imagens (INFRA 02).
 */

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    produto_id: row.produto_id,
    arquivo: row.arquivo,
    ordem: Number(row.ordem || 0),
    principal: Number(row.principal) === 1,
    ativo: Number(row.ativo) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class ProdutoImagemRepository {
  static TABELA = 'produto_imagens';

  /**
   * @param {Object} deps
   * @param {Object} deps.db sqlite3 Database
   */
  constructor(deps = {}) {
    this._db = deps.db;
    if (!this._db) {
      throw new Error('ProdutoImagemRepository requer db');
    }
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.run(sql, params, function cb(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  async buscarPorId(id) {
    const row = await this._get(
      `SELECT * FROM ${ProdutoImagemRepository.TABELA} WHERE id = ? LIMIT 1`,
      [id]
    );
    return mapRow(row);
  }

  async listarPorProduto(produtoId, opcoes = {}) {
    const apenasAtivos = opcoes.apenasAtivos !== false;
    const sql = apenasAtivos
      ? `SELECT * FROM ${ProdutoImagemRepository.TABELA}
         WHERE produto_id = ? AND ativo = 1
         ORDER BY principal DESC, ordem ASC, id ASC`
      : `SELECT * FROM ${ProdutoImagemRepository.TABELA}
         WHERE produto_id = ?
         ORDER BY principal DESC, ordem ASC, id ASC`;
    const rows = await this._all(sql, [produtoId]);
    return rows.map(mapRow);
  }

  async buscarPrincipalAtiva(produtoId) {
    const row = await this._get(
      `SELECT * FROM ${ProdutoImagemRepository.TABELA}
       WHERE produto_id = ? AND principal = 1 AND ativo = 1
       LIMIT 1`,
      [produtoId]
    );
    return mapRow(row);
  }

  async buscarAtivaPorArquivo(produtoId, arquivo) {
    const row = await this._get(
      `SELECT * FROM ${ProdutoImagemRepository.TABELA}
       WHERE produto_id = ? AND arquivo = ? AND ativo = 1
       LIMIT 1`,
      [produtoId, arquivo]
    );
    return mapRow(row);
  }

  async inserir({ produtoId, arquivo, ordem = 1, principal = false, ativo = true }) {
    const result = await this._run(
      `INSERT INTO ${ProdutoImagemRepository.TABELA} (
        produto_id, arquivo, ordem, principal, ativo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [
        produtoId,
        String(arquivo || '').trim(),
        Number(ordem) || 1,
        principal ? 1 : 0,
        ativo === false || ativo === 0 ? 0 : 1
      ]
    );
    return this.buscarPorId(result.lastID);
  }

  async atualizar(id, campos = {}) {
    const sets = [];
    const values = [];

    if (campos.arquivo !== undefined) {
      sets.push('arquivo = ?');
      values.push(String(campos.arquivo || '').trim());
    }
    if (campos.ordem !== undefined) {
      sets.push('ordem = ?');
      values.push(Number(campos.ordem) || 1);
    }
    if (campos.principal !== undefined) {
      sets.push('principal = ?');
      values.push(campos.principal ? 1 : 0);
    }
    if (campos.ativo !== undefined) {
      sets.push('ativo = ?');
      values.push(campos.ativo ? 1 : 0);
    }

    if (!sets.length) {
      return this.buscarPorId(id);
    }

    sets.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);

    await this._run(
      `UPDATE ${ProdutoImagemRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
      values
    );
    return this.buscarPorId(id);
  }

  async limparFlagPrincipal(produtoId) {
    return this._run(
      `UPDATE ${ProdutoImagemRepository.TABELA}
       SET principal = 0, updated_at = datetime('now', 'localtime')
       WHERE produto_id = ? AND principal = 1 AND ativo = 1`,
      [produtoId]
    );
  }

  async inativar(id) {
    return this.atualizar(id, { ativo: false, principal: false });
  }

  async inativarPrincipais(produtoId) {
    return this._run(
      `UPDATE ${ProdutoImagemRepository.TABELA}
       SET ativo = 0, principal = 0, updated_at = datetime('now', 'localtime')
       WHERE produto_id = ? AND principal = 1 AND ativo = 1`,
      [produtoId]
    );
  }

  async reordenar(produtoId, ordenacao = []) {
    // ordenacao: [{ id, ordem }]
    for (const item of ordenacao) {
      await this._run(
        `UPDATE ${ProdutoImagemRepository.TABELA}
         SET ordem = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND produto_id = ?`,
        [Number(item.ordem) || 1, item.id, produtoId]
      );
    }
    return this.listarPorProduto(produtoId);
  }
}

module.exports = ProdutoImagemRepository;
module.exports.ProdutoImagemRepository = ProdutoImagemRepository;
