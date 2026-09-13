/**
 * CentralHistoricoRepository — Persistência do histórico de transições de status.
 *
 * Tabela: `central_entradas_historico`
 *
 * @class CentralHistoricoRepository
 */

const IRepository = require('./IRepository');
const {
  resolverDb,
  criarDbHelpers,
  montarCamposUpdate,
  paginacao
} = require('./dbHelpers');

const MAPA_CAMPOS = {
  documentoId: 'documento_id',
  statusAnterior: 'status_anterior',
  statusNovo: 'status_novo',
  usuarioId: 'usuario_id',
  detalhe: 'detalhe'
};

class CentralHistoricoRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_historico';

  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   */
  constructor(deps = {}) {
    super(deps);
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._sql = null;
  }

  /** @returns {string} */
  getCodigo() {
    return CentralHistoricoRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Histórico de transições de status dos documentos fiscais';
  }

  /** @private */
  _obterSql() {
    if (!this._sql) {
      this._sql = criarDbHelpers(resolverDb(this._db));
    }
    return this._sql;
  }

  /**
   * @private
   * @param {Object|null} row
   * @returns {Object|null}
   */
  _mapearRow(row) {
    if (!row) return null;

    return {
      id: row.id,
      documentoId: row.documento_id,
      statusAnterior: row.status_anterior,
      statusNovo: row.status_novo,
      usuarioId: row.usuario_id,
      detalhe: row.detalhe,
      createdAt: row.created_at
    };
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralHistoricoRepository.TABELA} WHERE id = ?`,
      [id]
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

    if (filtros.documentoId || filtros.documento_id) {
      where.push('documento_id = ?');
      params.push(filtros.documentoId || filtros.documento_id);
    }

    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pag = paginacao(filtros);

    const rows = await sql.all(
      `SELECT * FROM ${CentralHistoricoRepository.TABELA} ${clausulaWhere} ORDER BY created_at DESC${pag.sql}`,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `INSERT INTO ${CentralHistoricoRepository.TABELA} (
        documento_id, status_anterior, status_novo, usuario_id, detalhe
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        dados.documentoId ?? dados.documento_id,
        dados.statusAnterior ?? dados.status_anterior ?? null,
        dados.statusNovo ?? dados.status_novo,
        dados.usuarioId ?? dados.usuario_id ?? null,
        dados.detalhe ?? null
      ]
    );

    return this.buscarPorId(resultado.lastID);
  }

  /**
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { sets, params } = montarCamposUpdate(dados, MAPA_CAMPOS);

    if (!sets.length) {
      return this.buscarPorId(id);
    }

    await sql.run(
      `UPDATE ${CentralHistoricoRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id]
    );

    return this.buscarPorId(id);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM ${CentralHistoricoRepository.TABELA} WHERE id = ?`,
      [id]
    );

    return resultado.changes > 0;
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object[]>}
   */
  async listarPorDocumento(documentoId) {
    return this.listar({ documentoId, limite: 200 });
  }
}

module.exports = CentralHistoricoRepository;
