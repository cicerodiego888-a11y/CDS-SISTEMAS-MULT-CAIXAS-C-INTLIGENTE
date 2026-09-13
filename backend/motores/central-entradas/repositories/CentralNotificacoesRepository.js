/**
 * CentralNotificacoesRepository — Notificações internas da Central.
 *
 * @class CentralNotificacoesRepository
 */

const IRepository = require('./IRepository');
const { resolverDb, criarDbHelpers } = require('./dbHelpers');

class CentralNotificacoesRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_notificacoes';

  constructor(deps = {}) {
    super(deps);
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._sql = null;
  }

  getCodigo() {
    return CentralNotificacoesRepository.TABELA;
  }

  getDescricao() {
    return 'Notificações internas da Central de Entradas';
  }

  /** @private */
  _obterSql() {
    if (!this._sql) {
      this._sql = criarDbHelpers(resolverDb(this._db));
    }
    return this._sql;
  }

  /** @private */
  _mapearRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      tipo: row.tipo,
      titulo: row.titulo,
      mensagem: row.mensagem,
      documentoId: row.documento_id,
      lida: row.lida === 1,
      createdAt: row.created_at
    };
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `INSERT INTO ${CentralNotificacoesRepository.TABELA}
       (tipo, titulo, mensagem, documento_id, lida)
       VALUES (?, ?, ?, ?, 0)`,
      [
        dados.tipo,
        dados.titulo,
        dados.mensagem ?? null,
        dados.documentoId ?? dados.documento_id ?? null
      ]
    );

    const row = await sql.get(
      `SELECT * FROM ${CentralNotificacoesRepository.TABELA} WHERE id = ?`,
      [resultado.lastID]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];
    if (filtros.apenasNaoLidas || filtros.apenas_nao_lidas) {
      where.push('lida = 0');
    }
    const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limite = Math.min(Number(filtros.limite) || 30, 100);

    const rows = await sql.all(
      `SELECT * FROM ${CentralNotificacoesRepository.TABELA}
       ${clausula}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [...params, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @returns {Promise<number>}
   */
  async contarNaoLidas() {
    const sql = this._obterSql();
    await sql.whenReady();
    const row = await sql.get(
      `SELECT COUNT(*) AS total FROM ${CentralNotificacoesRepository.TABELA} WHERE lida = 0`
    );
    return Number(row?.total || 0);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async marcarLida(id) {
    const sql = this._obterSql();
    await sql.whenReady();
    const resultado = await sql.run(
      `UPDATE ${CentralNotificacoesRepository.TABELA} SET lida = 1 WHERE id = ?`,
      [id]
    );
    return resultado.changes > 0;
  }

  /**
   * @returns {Promise<number>}
   */
  async marcarTodasLidas() {
    const sql = this._obterSql();
    await sql.whenReady();
    const resultado = await sql.run(
      `UPDATE ${CentralNotificacoesRepository.TABELA} SET lida = 1 WHERE lida = 0`
    );
    return resultado.changes;
  }
}

module.exports = CentralNotificacoesRepository;
