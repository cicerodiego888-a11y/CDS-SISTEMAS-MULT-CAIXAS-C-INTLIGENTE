/**
 * CentralConfigRepository — Configurações persistidas da Central de Entradas.
 *
 * @class CentralConfigRepository
 */

const IRepository = require('./IRepository');
const { resolverDb, criarDbHelpers, serializarJson, deserializarJson } = require('./dbHelpers');

class CentralConfigRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_config';

  constructor(deps = {}) {
    super(deps);
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._sql = null;
  }

  getCodigo() {
    return CentralConfigRepository.TABELA;
  }

  getDescricao() {
    return 'Configurações da Central Inteligente de Entradas';
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
      chave: row.chave,
      valor: row.valor,
      tipo: row.tipo,
      descricao: row.descricao,
      updatedAt: row.updated_at
    };
  }

  /**
   * @param {Object} registro
   * @returns {*}
   */
  parseValor(registro) {
    if (!registro || registro.valor == null) return null;
    const bruto = registro.valor;
    switch (registro.tipo) {
      case 'number':
        return Number(bruto);
      case 'boolean':
        return bruto === 'true' || bruto === '1' || bruto === 1;
      case 'json':
        return deserializarJson(bruto);
      default:
        return bruto;
    }
  }

  /**
   * @returns {Promise<Object[]>}
   */
  async listarTodas() {
    const sql = this._obterSql();
    await sql.whenReady();
    const rows = await sql.all(
      `SELECT * FROM ${CentralConfigRepository.TABELA} ORDER BY chave ASC`
    );
    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {string} chave
   * @returns {Promise<Object|null>}
   */
  async buscarPorChave(chave) {
    const sql = this._obterSql();
    await sql.whenReady();
    const row = await sql.get(
      `SELECT * FROM ${CentralConfigRepository.TABELA} WHERE chave = ?`,
      [chave]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {string} chave
   * @param {*} valor
   * @param {string} [tipo]
   * @returns {Promise<Object>}
   */
  async salvar(chave, valor, tipo = 'string') {
    const sql = this._obterSql();
    await sql.whenReady();

    let valorTexto;
    if (tipo === 'boolean') {
      valorTexto = valor ? 'true' : 'false';
    } else if (tipo === 'json') {
      valorTexto = serializarJson(valor);
    } else {
      valorTexto = String(valor ?? '');
    }

    const existente = await this.buscarPorChave(chave);
    if (existente) {
      await sql.run(
        `UPDATE ${CentralConfigRepository.TABELA}
         SET valor = ?, updated_at = datetime('now', 'localtime') WHERE chave = ?`,
        [valorTexto, chave]
      );
    } else {
      await sql.run(
        `INSERT INTO ${CentralConfigRepository.TABELA} (chave, valor, tipo) VALUES (?, ?, ?)`,
        [chave, valorTexto, tipo]
      );
    }

    return this.buscarPorChave(chave);
  }
}

module.exports = CentralConfigRepository;
