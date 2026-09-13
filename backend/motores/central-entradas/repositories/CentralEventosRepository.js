/**
 * CentralEventosRepository — Log operacional de eventos da Central.
 *
 * @class CentralEventosRepository
 */

const IRepository = require('./IRepository');
const { resolverDb, criarDbHelpers, serializarJson, deserializarJson } = require('./dbHelpers');

class CentralEventosRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_eventos';

  constructor(deps = {}) {
    super(deps);
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._sql = null;
  }

  getCodigo() {
    return CentralEventosRepository.TABELA;
  }

  getDescricao() {
    return 'Eventos operacionais da Central de Entradas';
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
      origem: row.origem,
      descricao: row.descricao,
      resultado: row.resultado,
      sucesso: row.sucesso === 1 ? true : (row.sucesso === 0 ? false : null),
      documentoId: row.documento_id,
      notasNovas: row.notas_novas,
      notasDuplicadas: row.notas_duplicadas,
      duracaoMs: row.duracao_ms,
      detalhe: deserializarJson(row.detalhe_json),
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
      `INSERT INTO ${CentralEventosRepository.TABELA} (
        tipo, origem, descricao, resultado, sucesso, documento_id,
        notas_novas, notas_duplicadas, duracao_ms, detalhe_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dados.tipo,
        dados.origem || 'sistema',
        dados.descricao ?? null,
        dados.resultado ?? null,
        dados.sucesso === true ? 1 : (dados.sucesso === false ? 0 : null),
        dados.documentoId ?? dados.documento_id ?? null,
        dados.notasNovas ?? dados.notas_novas ?? 0,
        dados.notasDuplicadas ?? dados.notas_duplicadas ?? 0,
        dados.duracaoMs ?? dados.duracao_ms ?? null,
        serializarJson(dados.detalhe ?? dados.detalheJson ?? null)
      ]
    );

    const row = await sql.get(
      `SELECT * FROM ${CentralEventosRepository.TABELA} WHERE id = ?`,
      [resultado.lastID]
    );
    return this._mapearRow(row);
  }

  /**
   * Insert idempotente — retorna { evento, criado } e não lança em unique violation.
   * @param {Object} dados
   * @returns {Promise<{ evento: Object|null, criado: boolean, conflito: boolean }>}
   */
  async inserirUnico(dados) {
    try {
      const evento = await this.inserir(dados);
      return { evento, criado: true, conflito: false };
    } catch (error) {
      const msg = String(error.message || error);
      if (/UNIQUE|constraint/i.test(msg)) {
        const existentes = await this.listar({
          tipo: dados.tipo,
          documentoId: dados.documentoId ?? dados.documento_id,
          limite: 1
        });
        return { evento: existentes[0] || null, criado: false, conflito: true };
      }
      throw error;
    }
  }

  /**
   * @param {string} tipo
   * @param {number|string} documentoId
   * @returns {Promise<boolean>}
   */
  async existePorTipoDocumento(tipo, documentoId) {
    const total = await this.contar({ tipo, documentoId });
    return total > 0;
  }

  /**
   * @param {string} tipo
   * @param {number|string} documentoId
   * @returns {Promise<boolean>}
   */
  async removerPorTipoDocumento(tipo, documentoId) {
    const sql = this._obterSql();
    await sql.whenReady();
    const resultado = await sql.run(
      `DELETE FROM ${CentralEventosRepository.TABELA}
       WHERE tipo = ? AND documento_id = ?`,
      [tipo, documentoId]
    );
    return resultado.changes > 0;
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { clausulaWhere, params } = this._montarWhere(filtros);
    const limite = Math.min(Number(filtros.limite) || 50, 200);
    const offset = Math.max(0, Number(filtros.offset) || 0);

    const rows = await sql.all(
      `SELECT * FROM ${CentralEventosRepository.TABELA}
       ${clausulaWhere}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limite, offset]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<number>}
   */
  async contar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();
    const { clausulaWhere, params } = this._montarWhere(filtros);
    const row = await sql.get(
      `SELECT COUNT(*) AS total FROM ${CentralEventosRepository.TABELA} ${clausulaWhere}`,
      params
    );
    return Number(row?.total || 0);
  }

  /**
   * @param {string} tipo
   * @returns {Promise<Object|null>}
   */
  async obterUltimoPorTipo(tipo) {
    const sql = this._obterSql();
    await sql.whenReady();
    const row = await sql.get(
      `SELECT * FROM ${CentralEventosRepository.TABELA}
       WHERE tipo = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tipo]
    );
    return this._mapearRow(row);
  }

  /**
   * @returns {Promise<number|null>}
   */
  async obterTempoMedioSyncMs() {
    const sql = this._obterSql();
    await sql.whenReady();
    const row = await sql.get(
      `SELECT AVG(duracao_ms) AS media
       FROM ${CentralEventosRepository.TABELA}
       WHERE tipo IN ('SYNC_CONCLUIDA', 'SYNC_ERRO') AND duracao_ms IS NOT NULL`
    );
    return row?.media != null ? Math.round(Number(row.media)) : null;
  }

  /**
   * @private
   */
  _montarWhere(filtros) {
    const where = [];
    const params = [];

    if (filtros.tipo) {
      where.push('tipo = ?');
      params.push(filtros.tipo);
    }
    if (filtros.origem) {
      where.push('origem = ?');
      params.push(filtros.origem);
    }
    if (filtros.documentoId != null || filtros.documento_id != null) {
      where.push('documento_id = ?');
      params.push(filtros.documentoId ?? filtros.documento_id);
    }
    if (filtros.busca) {
      const termo = `%${String(filtros.busca).trim()}%`;
      where.push('(descricao LIKE ? OR resultado LIKE ? OR tipo LIKE ?)');
      params.push(termo, termo, termo);
    }
    if (filtros.dataInicio) {
      where.push('date(created_at) >= date(?)');
      params.push(filtros.dataInicio);
    }
    if (filtros.dataFim) {
      where.push('date(created_at) <= date(?)');
      params.push(filtros.dataFim);
    }
    if (filtros.sucesso === true || filtros.sucesso === 'true') {
      where.push('sucesso = 1');
    } else if (filtros.sucesso === false || filtros.sucesso === 'false') {
      where.push('sucesso = 0');
    }

    return {
      clausulaWhere: where.length ? `WHERE ${where.join(' AND ')}` : '',
      params
    };
  }
}

module.exports = CentralEventosRepository;
