/**
 * CentralRevisaoItensRepository — Decisões por item da revisão MIIP.
 *
 * Tabela: `central_entradas_revisao_itens`
 *
 * @class CentralRevisaoItensRepository
 */

const IRepository = require('./IRepository');
const {
  resolverDb,
  criarDbHelpers,
  montarCamposUpdate,
  serializarJson,
  deserializarJson,
  paginacao
} = require('./dbHelpers');

const MAPA_CAMPOS = {
  sessaoId: 'sessao_id',
  documentoId: 'documento_id',
  itemIndex: 'item_index',
  produtoOrigem: 'produto_origem',
  produtoDestinoId: 'produto_destino_id',
  decisao: 'decisao',
  status: 'status',
  dadosJson: 'dados_json',
  usuarioId: 'usuario_id'
};

class CentralRevisaoItensRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_revisao_itens';

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
    return CentralRevisaoItensRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Itens/decisões de revisão MIIP da Central de Entradas';
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
      sessaoId: row.sessao_id,
      documentoId: row.documento_id,
      itemIndex: row.item_index,
      produtoOrigem: row.produto_origem,
      produtoDestinoId: row.produto_destino_id,
      decisao: row.decisao,
      status: row.status,
      dadosJson: deserializarJson(row.dados_json),
      usuarioId: row.usuario_id,
      criadoEm: row.criado_em,
      atualizadoEm: row.atualizado_em
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
      `SELECT * FROM ${CentralRevisaoItensRepository.TABELA} WHERE id = ?`,
      [id]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {number|string} sessaoId
   * @returns {Promise<Object[]>}
   */
  async buscarPorSessao(sessaoId) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralRevisaoItensRepository.TABELA}
       WHERE sessao_id = ?
       ORDER BY item_index ASC`,
      [sessaoId]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {number|string} sessaoId
   * @param {number} itemIndex
   * @returns {Promise<Object|null>}
   */
  async buscarPorSessaoEIndice(sessaoId, itemIndex) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralRevisaoItensRepository.TABELA}
       WHERE sessao_id = ? AND item_index = ?`,
      [sessaoId, itemIndex]
    );
    return this._mapearRow(row);
  }

  /**
   * Upsert idempotente em (sessao_id, item_index).
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async upsert(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const sessaoId = dados.sessaoId ?? dados.sessao_id;
    const itemIndex = dados.itemIndex ?? dados.item_index;
    const documentoId = dados.documentoId ?? dados.documento_id;
    const produtoOrigem = dados.produtoOrigem ?? dados.produto_origem ?? null;
    const produtoDestinoId = dados.produtoDestinoId ?? dados.produto_destino_id ?? null;
    const decisao = dados.decisao;
    const status = dados.status ?? 'CONCLUIDO';
    const dadosJson = serializarJson(dados.dadosJson ?? dados.dados_json ?? null);
    const usuarioId = dados.usuarioId ?? dados.usuario_id ?? null;

    await sql.run(
      `INSERT INTO ${CentralRevisaoItensRepository.TABELA} (
        sessao_id, documento_id, item_index, produto_origem, produto_destino_id,
        decisao, status, dados_json, usuario_id, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(sessao_id, item_index) DO UPDATE SET
        produto_origem = excluded.produto_origem,
        produto_destino_id = excluded.produto_destino_id,
        decisao = excluded.decisao,
        status = excluded.status,
        dados_json = excluded.dados_json,
        usuario_id = excluded.usuario_id,
        atualizado_em = datetime('now')`,
      [
        sessaoId,
        documentoId,
        itemIndex,
        produtoOrigem,
        produtoDestinoId,
        decisao,
        status,
        dadosJson,
        usuarioId
      ]
    );

    return this.buscarPorSessaoEIndice(sessaoId, itemIndex);
  }

  /**
   * @param {number|string} sessaoId
   * @returns {Promise<number>}
   */
  async contarConcluidos(sessaoId) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT COUNT(*) AS total FROM ${CentralRevisaoItensRepository.TABELA}
       WHERE sessao_id = ? AND status = 'CONCLUIDO'`,
      [sessaoId]
    );

    return Number(row?.total || 0);
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

    if (filtros.sessaoId || filtros.sessao_id) {
      where.push('sessao_id = ?');
      params.push(filtros.sessaoId || filtros.sessao_id);
    }
    if (filtros.documentoId || filtros.documento_id) {
      where.push('documento_id = ?');
      params.push(filtros.documentoId || filtros.documento_id);
    }

    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pag = paginacao(filtros);

    const rows = await sql.all(
      `SELECT * FROM ${CentralRevisaoItensRepository.TABELA}
       ${clausulaWhere}
       ORDER BY item_index ASC${pag.sql}`,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    return this.upsert(dados);
  }

  /**
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const payload = { ...dados };
    if (payload.dadosJson !== undefined || payload.dados_json !== undefined) {
      payload.dadosJson = serializarJson(payload.dadosJson ?? payload.dados_json);
      delete payload.dados_json;
    }

    const { sets, params } = montarCamposUpdate(payload, MAPA_CAMPOS);

    if (!sets.length) {
      return this.buscarPorId(id);
    }

    sets.push("atualizado_em = datetime('now')");

    await sql.run(
      `UPDATE ${CentralRevisaoItensRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
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
      `DELETE FROM ${CentralRevisaoItensRepository.TABELA} WHERE id = ?`,
      [id]
    );

    return resultado.changes > 0;
  }
}

module.exports = CentralRevisaoItensRepository;
