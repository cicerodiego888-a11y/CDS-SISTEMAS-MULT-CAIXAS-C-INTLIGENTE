/**
 * MiipSinonimosRepository — Persistência de sinônimos e termos normalizados.
 *
 * @deprecated RC1 — Não participa do runtime. O motor `motor_synonyms` utiliza
 * dicionários JSON (`config/synonyms/*.json` via `SynonymDictionary`).
 * Reservado para futura evolução do MIIP V2.
 *
 * Tabela: `miip_sinonimos`
 *
 * @class MiipSinonimosRepository
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
  termo: 'termo',
  termoNormalizado: 'termo_normalizado',
  termoCanonico: 'termo_canonico',
  tipo: 'tipo',
  produtoId: 'produto_id',
  fornecedorCnpj: 'fornecedor_cnpj',
  peso: 'peso',
  origem: 'origem',
  ativo: 'ativo',
  usoCount: 'uso_count',
  metadados: 'metadados'
};

class MiipSinonimosRepository extends IRepository {
  /** @readonly */
  static TABELA = 'miip_sinonimos';

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
    return MiipSinonimosRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Persistência de sinônimos e aliases textuais';
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
      termo: row.termo,
      termoNormalizado: row.termo_normalizado,
      termoCanonico: row.termo_canonico,
      tipo: row.tipo,
      produtoId: row.produto_id,
      fornecedorCnpj: row.fornecedor_cnpj,
      peso: row.peso,
      origem: row.origem,
      ativo: row.ativo === 1,
      usoCount: row.uso_count,
      metadados: deserializarJson(row.metadados),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Insere um novo sinônimo.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `
        INSERT INTO miip_sinonimos (
          termo, termo_normalizado, termo_canonico, tipo, produto_id, fornecedor_cnpj,
          peso, origem, ativo, uso_count, metadados, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        dados.termo,
        dados.termoNormalizado,
        dados.termoCanonico ?? null,
        dados.tipo ?? 'geral',
        dados.produtoId ?? null,
        dados.fornecedorCnpj ?? null,
        dados.peso ?? 1.0,
        dados.origem ?? 'manual',
        dados.ativo === false ? 0 : 1,
        dados.usoCount ?? 0,
        serializarJson(dados.metadados)
      ]
    );

    return this.buscarPorId(resultado.lastID);
  }

  /**
   * Atualiza um sinônimo existente.
   *
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { sets, params } = montarCamposUpdate(dados, MAPA_CAMPOS, (key, value) => {
      if (key === 'ativo') return value ? 1 : 0;
      if (key === 'metadados') return serializarJson(value);
      return value;
    });

    if (sets.length === 0) {
      return this.buscarPorId(id);
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');

    const resultado = await sql.run(
      `UPDATE miip_sinonimos SET ${sets.join(', ')} WHERE id = ?`,
      [...params, Number(id)]
    );

    return resultado.changes > 0 ? this.buscarPorId(id) : null;
  }

  /**
   * Busca sinônimo por ID.
   *
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_sinonimos WHERE id = ? LIMIT 1`,
      [Number(id)]
    );

    return this._mapearRow(row);
  }

  /**
   * Lista sinônimos com filtros estruturais.
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.termoNormalizado) {
      where.push('termo_normalizado = ?');
      params.push(filtros.termoNormalizado);
    }
    if (filtros.tipo) {
      where.push('tipo = ?');
      params.push(filtros.tipo);
    }
    if (filtros.produtoId != null) {
      where.push('produto_id = ?');
      params.push(Number(filtros.produtoId));
    }
    if (filtros.fornecedorCnpj) {
      where.push('fornecedor_cnpj = ?');
      params.push(filtros.fornecedorCnpj);
    }
    if (filtros.ativo != null) {
      where.push('ativo = ?');
      params.push(filtros.ativo ? 1 : 0);
    }

    const pag = paginacao(filtros);
    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await sql.all(
      `
        SELECT * FROM miip_sinonimos
        ${clausulaWhere}
        ORDER BY id DESC
        ${pag.sql}
      `,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Remove sinônimo por ID.
   *
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM miip_sinonimos WHERE id = ?`,
      [Number(id)]
    );

    return resultado.changes > 0;
  }

  /**
   * Busca sinônimos por termo normalizado.
   *
   * @param {string} termoNormalizado
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async buscarPorTermoNormalizado(termoNormalizado, filtros = {}) {
    if (!termoNormalizado) return [];
    return this.listar({ ...filtros, termoNormalizado });
  }

  /**
   * Lista sinônimos de um produto.
   *
   * @param {number} produtoId
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listarPorProduto(produtoId, filtros = {}) {
    if (!produtoId) return [];
    return this.listar({ ...filtros, produtoId: Number(produtoId) });
  }

  /**
   * Lista sinônimos de um fornecedor.
   *
   * @param {string} fornecedorCnpj
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listarPorFornecedor(fornecedorCnpj, filtros = {}) {
    if (!fornecedorCnpj) return [];
    return this.listar({ ...filtros, fornecedorCnpj });
  }

  /**
   * Incrementa contador de uso do sinônimo.
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  async incrementarUso(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    await sql.run(
      `
        UPDATE miip_sinonimos
        SET uso_count = COALESCE(uso_count, 0) + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [Number(id)]
    );
  }
}

module.exports = new MiipSinonimosRepository();
module.exports.MiipSinonimosRepository = MiipSinonimosRepository;
