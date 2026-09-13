/**
 * MiipConfiguracoesRepository — Persistência de configuração runtime do MIIP.
 *
 * Tabela: `miip_configuracoes`
 * Sprint 2.1: CRUD e consultas — sem regra de negócio.
 *
 * @class MiipConfiguracoesRepository
 */

const IRepository = require('./IRepository');
const {
  resolverDb,
  criarDbHelpers,
  serializarJson,
  deserializarJson,
  montarCamposUpdate,
  paginacao
} = require('./dbHelpers');

const MAPA_CAMPOS = {
  chave: 'chave',
  valor: 'valor',
  tipo: 'tipo',
  categoria: 'categoria',
  descricao: 'descricao',
  editavel: 'editavel',
  versao: 'versao',
  metadados: 'metadados'
};

class MiipConfiguracoesRepository extends IRepository {
  /** @readonly */
  static TABELA = 'miip_configuracoes';

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
    return MiipConfiguracoesRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Persistência de configurações runtime do MIIP';
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
      chave: row.chave,
      valor: row.valor,
      tipo: row.tipo,
      categoria: row.categoria,
      descricao: row.descricao,
      editavel: row.editavel === 1,
      versao: row.versao,
      metadados: deserializarJson(row.metadados),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Converte valor conforme tipo declarado (apenas desserialização).
   *
   * @param {Object} registro
   * @returns {*}
   */
  parseValor(registro) {
    if (!registro) return null;

    const bruto = registro.valor;
    if (bruto == null) return null;

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
   * Insere uma nova configuração.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const valor = dados.valor == null
      ? null
      : (typeof dados.valor === 'object' ? serializarJson(dados.valor) : String(dados.valor));

    const resultado = await sql.run(
      `
        INSERT INTO miip_configuracoes (
          chave, valor, tipo, categoria, descricao, editavel, versao, metadados, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        dados.chave,
        valor,
        dados.tipo ?? 'string',
        dados.categoria ?? 'geral',
        dados.descricao ?? null,
        dados.editavel === false ? 0 : 1,
        dados.versao ?? 1,
        serializarJson(dados.metadados)
      ]
    );

    return this.buscarPorId(resultado.lastID);
  }

  /**
   * Atualiza uma configuração existente.
   *
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const payload = { ...dados };
    if (payload.valor !== undefined && payload.valor != null && typeof payload.valor === 'object') {
      payload.valor = serializarJson(payload.valor);
    } else if (payload.valor !== undefined && payload.valor != null) {
      payload.valor = String(payload.valor);
    }

    const { sets, params } = montarCamposUpdate(payload, MAPA_CAMPOS, (key, value) => {
      if (key === 'editavel') return value ? 1 : 0;
      if (key === 'metadados') return serializarJson(value);
      return value;
    });

    if (sets.length === 0) {
      return this.buscarPorId(id);
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');

    const resultado = await sql.run(
      `UPDATE miip_configuracoes SET ${sets.join(', ')} WHERE id = ?`,
      [...params, Number(id)]
    );

    return resultado.changes > 0 ? this.buscarPorId(id) : null;
  }

  /**
   * Busca configuração por ID interno.
   *
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_configuracoes WHERE id = ? LIMIT 1`,
      [Number(id)]
    );

    return this._mapearRow(row);
  }

  /**
   * Busca configuração por chave única.
   *
   * @param {string} chave
   * @returns {Promise<Object|null>}
   */
  async buscarPorChave(chave) {
    if (!chave) return null;

    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_configuracoes WHERE chave = ? LIMIT 1`,
      [String(chave)]
    );

    return this._mapearRow(row);
  }

  /**
   * Lista configurações com filtros estruturais.
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.chave) {
      where.push('chave = ?');
      params.push(filtros.chave);
    }
    if (filtros.categoria) {
      where.push('categoria = ?');
      params.push(filtros.categoria);
    }
    if (filtros.tipo) {
      where.push('tipo = ?');
      params.push(filtros.tipo);
    }
    if (filtros.editavel != null) {
      where.push('editavel = ?');
      params.push(filtros.editavel ? 1 : 0);
    }

    const pag = paginacao(filtros);
    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await sql.all(
      `
        SELECT * FROM miip_configuracoes
        ${clausulaWhere}
        ORDER BY categoria ASC, chave ASC
        ${pag.sql}
      `,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Lista configurações por categoria.
   *
   * @param {string} categoria
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listarPorCategoria(categoria, filtros = {}) {
    if (!categoria) return [];
    return this.listar({ ...filtros, categoria });
  }

  /**
   * Remove configuração por ID.
   *
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM miip_configuracoes WHERE id = ?`,
      [Number(id)]
    );

    return resultado.changes > 0;
  }

  /**
   * Insere ou atualiza configuração por chave.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async upsertPorChave(dados) {
    const existente = await this.buscarPorChave(dados.chave);

    if (existente) {
      const atualizado = await this.atualizar(existente.id, dados);
      return atualizado;
    }

    return this.inserir(dados);
  }
}

module.exports = new MiipConfiguracoesRepository();
module.exports.MiipConfiguracoesRepository = MiipConfiguracoesRepository;
