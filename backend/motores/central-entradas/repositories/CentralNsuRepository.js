/**
 * CentralNsuRepository — Persistência do controle de NSU da Distribuição DF-e.
 *
 * Tabela: `central_entradas_nsu`
 *
 * @class CentralNsuRepository
 */

const IRepository = require('./IRepository');
const {
  resolverDb,
  criarDbHelpers,
  montarCamposUpdate
} = require('./dbHelpers');

const MAPA_CAMPOS = {
  cnpj: 'cnpj',
  ambiente: 'ambiente',
  ultNsu: 'ult_nsu',
  maxNsu: 'max_nsu',
  dataSincronizacao: 'data_sincronizacao',
  cooldownAte: 'cooldown_ate',
  ultimoCstat: 'ultimo_cstat'
};

class CentralNsuRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_nsu';

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
    return CentralNsuRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Controle de ultNSU por CNPJ e ambiente fiscal';
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
      cnpj: row.cnpj,
      ambiente: row.ambiente,
      ultNsu: row.ult_nsu,
      maxNsu: row.max_nsu,
      dataSincronizacao: row.data_sincronizacao,
      cooldownAte: row.cooldown_ate || null,
      ultimoCstat: row.ultimo_cstat || null,
      updatedAt: row.updated_at
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
      `SELECT * FROM ${CentralNsuRepository.TABELA} WHERE id = ?`,
      [id]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {string} cnpj
   * @param {number} ambiente
   * @returns {Promise<Object|null>}
   */
  async buscarPorCnpjAmbiente(cnpj, ambiente) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralNsuRepository.TABELA} WHERE cnpj = ? AND ambiente = ?`,
      [cnpj, ambiente]
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

    if (filtros.cnpj) {
      where.push('cnpj = ?');
      params.push(filtros.cnpj);
    }

    if (filtros.ambiente != null) {
      where.push('ambiente = ?');
      params.push(filtros.ambiente);
    }

    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await sql.all(
      `SELECT * FROM ${CentralNsuRepository.TABELA} ${clausulaWhere} ORDER BY updated_at DESC`,
      params
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
      `INSERT INTO ${CentralNsuRepository.TABELA} (cnpj, ambiente, ult_nsu, max_nsu, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [
        dados.cnpj,
        dados.ambiente ?? 2,
        dados.ultNsu ?? dados.ult_nsu ?? '000000000000000',
        dados.maxNsu ?? dados.max_nsu ?? '000000000000000'
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

    sets.push("updated_at = datetime('now')");

    await sql.run(
      `UPDATE ${CentralNsuRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
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
      `DELETE FROM ${CentralNsuRepository.TABELA} WHERE id = ?`,
      [id]
    );

    return resultado.changes > 0;
  }

  /**
   * @param {string} cnpj
   * @param {number} ambiente
   * @returns {Promise<Object>}
   */
  async obterOuCriar(cnpj, ambiente) {
    const existente = await this.buscarPorCnpjAmbiente(cnpj, ambiente);
    if (existente) return existente;

    return this.inserir({
      cnpj,
      ambiente,
      ultNsu: '000000000000000',
      maxNsu: '000000000000000'
    });
  }

  /**
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizarSincronizacao(id, dados) {
    return this.atualizarSincronizacaoSegura(id, dados);
  }

  /**
   * Atualização segura RC3.3.3 — monotônica e capaz de preservar NSU.
   *
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizarSincronizacaoSegura(id, dados = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const dataSync = dados.dataSincronizacao ?? new Date().toISOString();
    const ultimoCstat = dados.ultimoCstat !== undefined ? dados.ultimoCstat : undefined;
    const cooldownAte = dados.cooldownAte !== undefined ? dados.cooldownAte : undefined;

    if (dados.preservarNsu) {
      const sets = ["data_sincronizacao = ?", "updated_at = datetime('now')"];
      const params = [dataSync];
      if (ultimoCstat !== undefined) {
        sets.push('ultimo_cstat = ?');
        params.push(ultimoCstat);
      }
      if (cooldownAte !== undefined) {
        sets.push('cooldown_ate = ?');
        params.push(cooldownAte);
      }
      params.push(id);
      await sql.run(
        `UPDATE ${CentralNsuRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
        params
      );
      return this.buscarPorId(id);
    }

    const ultNsu = dados.ultNsu ?? dados.ult_nsu;
    const maxNsu = dados.maxNsu ?? dados.max_nsu;
    if (ultNsu == null || maxNsu == null) {
      return this.buscarPorId(id);
    }

    // Comparação lexicográfica funciona para NSU zero-padded (15 dígitos).
    const sets = [
      'ult_nsu = CASE WHEN ? >= ult_nsu THEN ? ELSE ult_nsu END',
      'max_nsu = CASE WHEN ? >= ult_nsu THEN ? ELSE max_nsu END',
      'data_sincronizacao = ?',
      "updated_at = datetime('now')"
    ];
    const params = [ultNsu, ultNsu, ultNsu, maxNsu, dataSync];

    if (ultimoCstat !== undefined) {
      sets.push('ultimo_cstat = ?');
      params.push(ultimoCstat);
    }
    if (cooldownAte !== undefined) {
      sets.push('cooldown_ate = ?');
      params.push(cooldownAte);
    }

    params.push(id);
    await sql.run(
      `UPDATE ${CentralNsuRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    return this.buscarPorId(id);
  }

  /**
   * @returns {Promise<Object|null>}
   */
  async obterUltimaSincronizacao() {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralNsuRepository.TABELA}
       ORDER BY COALESCE(data_sincronizacao, updated_at) DESC
       LIMIT 1`
    );

    return this._mapearRow(row);
  }
}

module.exports = CentralNsuRepository;
