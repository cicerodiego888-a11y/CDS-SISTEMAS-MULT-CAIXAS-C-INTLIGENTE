/**
 * CentralRevisaoSessoesRepository — Sessões de revisão MIIP persistentes.
 *
 * Tabela: `central_entradas_revisao_sessoes`
 *
 * @class CentralRevisaoSessoesRepository
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
  usuarioId: 'usuario_id',
  status: 'status',
  totalItens: 'total_itens',
  itensConcluidos: 'itens_concluidos',
  itemAtual: 'item_atual',
  correlationId: 'correlation_id',
  concluidoEm: 'concluido_em'
};

class CentralRevisaoSessoesRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_revisao_sessoes';

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
    return CentralRevisaoSessoesRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Sessões de revisão MIIP da Central de Entradas';
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
      usuarioId: row.usuario_id,
      status: row.status,
      totalItens: row.total_itens,
      itensConcluidos: row.itens_concluidos,
      itemAtual: row.item_atual,
      correlationId: row.correlation_id,
      criadoEm: row.criado_em,
      atualizadoEm: row.atualizado_em,
      concluidoEm: row.concluido_em
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
      `SELECT * FROM ${CentralRevisaoSessoesRepository.TABELA} WHERE id = ?`,
      [id]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object|null>}
   */
  async buscarAtivaPorDocumento(documentoId) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralRevisaoSessoesRepository.TABELA}
       WHERE documento_id = ? AND status = 'EM_ANDAMENTO'
       ORDER BY id DESC LIMIT 1`,
      [documentoId]
    );
    return this._mapearRow(row);
  }

  /**
   * Última sessão do documento (qualquer status).
   * @param {number|string} documentoId
   * @returns {Promise<Object|null>}
   */
  async buscarUltimaPorDocumento(documentoId) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralRevisaoSessoesRepository.TABELA}
       WHERE documento_id = ?
       ORDER BY id DESC LIMIT 1`,
      [documentoId]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {Array<number|string>} ids
   * @returns {Promise<Object[]>}
   */
  async listarPorDocumentos(ids = []) {
    const lista = (Array.isArray(ids) ? ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!lista.length) return [];

    const sql = this._obterSql();
    await sql.whenReady();

    const placeholders = lista.map(() => '?').join(', ');
    const rows = await sql.all(
      `SELECT * FROM ${CentralRevisaoSessoesRepository.TABELA}
       WHERE documento_id IN (${placeholders})
       ORDER BY id DESC`,
      lista
    );

    return rows.map((row) => this._mapearRow(row));
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
    if (filtros.status) {
      where.push('status = ?');
      params.push(filtros.status);
    }

    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pag = paginacao(filtros);

    const rows = await sql.all(
      `SELECT * FROM ${CentralRevisaoSessoesRepository.TABELA}
       ${clausulaWhere}
       ORDER BY id DESC${pag.sql}`,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async criar(dados) {
    return this.inserir(dados);
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `INSERT INTO ${CentralRevisaoSessoesRepository.TABELA} (
        documento_id, usuario_id, status, total_itens, itens_concluidos,
        item_atual, correlation_id, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        dados.documentoId ?? dados.documento_id,
        dados.usuarioId ?? dados.usuario_id ?? null,
        dados.status ?? 'EM_ANDAMENTO',
        dados.totalItens ?? dados.total_itens ?? 0,
        dados.itensConcluidos ?? dados.itens_concluidos ?? 0,
        dados.itemAtual ?? dados.item_atual ?? 0,
        dados.correlationId ?? dados.correlation_id ?? null
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

    sets.push("atualizado_em = datetime('now')");

    await sql.run(
      `UPDATE ${CentralRevisaoSessoesRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id]
    );

    return this.buscarPorId(id);
  }

  /**
   * @param {number|string} id
   * @param {Object} [opcoes]
   * @returns {Promise<Object|null>}
   */
  async marcarConcluida(id, opcoes = {}) {
    return this.atualizar(id, {
      status: 'CONCLUIDA',
      concluidoEm: opcoes.concluidoEm ?? new Date().toISOString(),
      itensConcluidos: opcoes.itensConcluidos,
      itemAtual: opcoes.itemAtual
    });
  }

  /**
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM ${CentralRevisaoSessoesRepository.TABELA} WHERE id = ?`,
      [id]
    );

    return resultado.changes > 0;
  }
}

module.exports = CentralRevisaoSessoesRepository;
