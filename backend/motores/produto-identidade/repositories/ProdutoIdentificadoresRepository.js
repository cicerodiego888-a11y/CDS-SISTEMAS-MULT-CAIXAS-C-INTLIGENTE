/**
 * ProdutoIdentificadoresRepository — persistência do catálogo MIP (Sprint 01).
 * Sem regra de negócio de resolução (isso é Sprint 02).
 * @module motores/produto-identidade/repositories/ProdutoIdentificadoresRepository
 */

const { resolverDb, criarDbHelpers, serializarJson, deserializarJson } = require('../../miip/repositories/dbHelpers');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    produtoId: row.produto_id,
    tipo: row.tipo,
    codigo: row.codigo,
    codigoExibicao: row.codigo_exibicao,
    escopo: row.escopo,
    escopoValor: row.escopo_valor,
    ativo: Number(row.ativo) === 1,
    principal: Number(row.principal) === 1,
    origem: row.origem,
    metadados: deserializarJson(row.metadados),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class ProdutoIdentificadoresRepository {
  static TABELA = 'produto_identificadores';

  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   */
  constructor(deps = {}) {
    // deps.db ausente/null → banco oficial; NÃO passar o objeto deps inteiro (é truthy e quebra o dual-write)
    this._db = deps.db != null ? deps.db : resolverDb(null);
    this._helpers = this._db ? criarDbHelpers(this._db) : null;
  }

  async _ready() {
    if (!this._helpers) throw new Error('Database não disponível para ProdutoIdentificadoresRepository.');
    await this._helpers.whenReady();
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados = {}) {
    await this._ready();
    const result = await this._helpers.run(
      `INSERT INTO ${ProdutoIdentificadoresRepository.TABELA} (
        produto_id, tipo, codigo, codigo_exibicao, escopo, escopo_valor,
        ativo, principal, origem, metadados, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        dados.produtoId,
        String(dados.tipo || '').toUpperCase(),
        String(dados.codigo || ''),
        dados.codigoExibicao != null ? String(dados.codigoExibicao) : null,
        dados.escopo != null ? String(dados.escopo) : null,
        dados.escopoValor != null ? String(dados.escopoValor) : null,
        dados.ativo === false || dados.ativo === 0 ? 0 : 1,
        dados.principal === true || dados.principal === 1 ? 1 : 0,
        dados.origem != null ? String(dados.origem) : 'cadastro',
        serializarJson(dados.metadados)
      ]
    );
    return this.buscarPorId(result.lastID);
  }

  /**
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    await this._ready();
    const row = await this._helpers.get(
      `SELECT * FROM ${ProdutoIdentificadoresRepository.TABELA} WHERE id = ? LIMIT 1`,
      [id]
    );
    return mapRow(row);
  }

  /**
   * @param {number} produtoId
   * @param {{ apenasAtivos?: boolean }} [opcoes]
   * @returns {Promise<Object[]>}
   */
  async listarPorProduto(produtoId, opcoes = {}) {
    await this._ready();
    const apenasAtivos = opcoes.apenasAtivos !== false;
    const sql = apenasAtivos
      ? `SELECT * FROM ${ProdutoIdentificadoresRepository.TABELA}
         WHERE produto_id = ? AND ativo = 1 ORDER BY principal DESC, id ASC`
      : `SELECT * FROM ${ProdutoIdentificadoresRepository.TABELA}
         WHERE produto_id = ? ORDER BY principal DESC, id ASC`;
    const rows = await this._helpers.all(sql, [produtoId]);
    return rows.map(mapRow);
  }

  /**
   * @param {string} tipo
   * @param {string} codigo
   * @param {{ escopo?: string|null, escopoValor?: string|null, apenasAtivos?: boolean }} [opcoes]
   * @returns {Promise<Object|null>}
   */
  async buscarPorTipoCodigo(tipo, codigo, opcoes = {}) {
    await this._ready();
    const apenasAtivos = opcoes.apenasAtivos !== false;
    const escopo = opcoes.escopo != null ? String(opcoes.escopo) : null;
    const escopoValor = opcoes.escopoValor != null ? String(opcoes.escopoValor) : null;

    const row = await this._helpers.get(
      `SELECT * FROM ${ProdutoIdentificadoresRepository.TABELA}
       WHERE tipo = ?
         AND codigo = ?
         AND ifnull(escopo, '') = ifnull(?, '')
         AND ifnull(escopo_valor, '') = ifnull(?, '')
         ${apenasAtivos ? 'AND ativo = 1' : ''}
       LIMIT 1`,
      [String(tipo).toUpperCase(), String(codigo), escopo, escopoValor]
    );
    return mapRow(row);
  }

  /**
   * @param {number} produtoId
   * @param {string} tipo
   * @returns {Promise<Object|null>}
   */
  async buscarPrincipal(produtoId, tipo) {
    await this._ready();
    const row = await this._helpers.get(
      `SELECT * FROM ${ProdutoIdentificadoresRepository.TABELA}
       WHERE produto_id = ? AND tipo = ? AND principal = 1 AND ativo = 1
       LIMIT 1`,
      [produtoId, String(tipo).toUpperCase()]
    );
    return mapRow(row);
  }

  /**
   * @param {number} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados = {}) {
    await this._ready();
    const sets = [];
    const params = [];

    const map = {
      codigo: 'codigo',
      codigoExibicao: 'codigo_exibicao',
      escopo: 'escopo',
      escopoValor: 'escopo_valor',
      origem: 'origem',
      tipo: 'tipo'
    };

    for (const [jsKey, col] of Object.entries(map)) {
      if (dados[jsKey] !== undefined) {
        sets.push(`${col} = ?`);
        let val = dados[jsKey];
        if (jsKey === 'tipo' && val != null) val = String(val).toUpperCase();
        params.push(val);
      }
    }

    if (dados.ativo !== undefined) {
      sets.push('ativo = ?');
      params.push(dados.ativo === false || dados.ativo === 0 ? 0 : 1);
    }
    if (dados.principal !== undefined) {
      sets.push('principal = ?');
      params.push(dados.principal === true || dados.principal === 1 ? 1 : 0);
    }
    if (dados.metadados !== undefined) {
      sets.push('metadados = ?');
      params.push(serializarJson(dados.metadados));
    }

    if (sets.length === 0) return this.buscarPorId(id);

    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await this._helpers.run(
      `UPDATE ${ProdutoIdentificadoresRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    return this.buscarPorId(id);
  }

  /**
   * Soft-disable.
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async desativar(id) {
    return this.atualizar(id, { ativo: false, principal: false });
  }

  /**
   * Contagem total (backfill / diagnóstico).
   * @returns {Promise<number>}
   */
  async contar() {
    await this._ready();
    const row = await this._helpers.get(
      `SELECT COUNT(*) AS c FROM ${ProdutoIdentificadoresRepository.TABELA}`
    );
    return Number(row?.c || 0);
  }
}

module.exports = ProdutoIdentificadoresRepository;
module.exports.ProdutoIdentificadoresRepository = ProdutoIdentificadoresRepository;
