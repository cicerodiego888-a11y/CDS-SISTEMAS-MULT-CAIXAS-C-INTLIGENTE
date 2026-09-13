/**
 * MiipAssociacoesRepository — Persistência de associações item externo → produto.
 *
 * Tabela: `miip_associacoes`
 * Sprint 2.1: CRUD e consultas — sem regra de negócio.
 *
 * @class MiipAssociacoesRepository
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
  produtoId: 'produto_id',
  origem: 'origem',
  fornecedorCnpj: 'fornecedor_cnpj',
  fornecedorNome: 'fornecedor_nome',
  codigoFornecedor: 'codigo_fornecedor',
  codigoBarras: 'codigo_barras',
  nomeItem: 'nome_item',
  nomeNormalizado: 'nome_normalizado',
  ncm: 'ncm',
  unidade: 'unidade',
  score: 'score',
  confianca: 'confianca',
  status: 'status',
  fonte: 'fonte',
  decisaoOperacaoId: 'decisao_operacao_id',
  confirmadoPorUsuarioId: 'confirmado_por_usuario_id',
  metadados: 'metadados',
  lastUsedAt: 'last_used_at'
};

class MiipAssociacoesRepository extends IRepository {
  /** @readonly */
  static TABELA = 'miip_associacoes';

  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db] - Instância SQLite
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
    return MiipAssociacoesRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Persistência de associações entre itens externos e produtos internos';
  }

  /**
   * @private
   * @returns {ReturnType<typeof criarDbHelpers>}
   */
  _obterSql() {
    if (!this._sql) {
      this._sql = criarDbHelpers(resolverDb(this._db));
    }
    return this._sql;
  }

  /**
   * @private
   * @param {Object|null} row
   * @param {boolean} [comProduto]
   * @returns {Object|null}
   */
  _mapearRow(row, comProduto = false) {
    if (!row) return null;

    const metadados = deserializarJson(row.metadados) || {};

    const registro = {
      id: row.id,
      produtoId: row.produto_id,
      origem: row.origem,
      fornecedorCnpj: row.fornecedor_cnpj,
      fornecedorNome: row.fornecedor_nome,
      codigoFornecedor: row.codigo_fornecedor,
      codigoBarras: row.codigo_barras,
      nomeItem: row.nome_item,
      nomeNormalizado: row.nome_normalizado,
      ncm: row.ncm,
      unidade: row.unidade,
      score: row.score,
      confianca: row.confianca,
      status: row.status,
      fonte: row.fonte,
      decisaoOperacaoId: row.decisao_operacao_id,
      confirmadoPorUsuarioId: row.confirmado_por_usuario_id,
      metadados,
      confirmacoes: Number(metadados.confirmacoes ?? 0),
      ultimaConfirmacao: metadados.ultima_confirmacao ?? row.last_used_at ?? null,
      ultimoUsuario: metadados.ultimo_usuario ?? row.confirmado_por_usuario_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at
    };

    if (comProduto && row.produto_codigo != null) {
      registro.produto = {
        id: row.produto_id,
        codigo: row.produto_codigo,
        nome: row.produto_nome,
        codigoBarras: row.produto_codigo_barras,
        ativo: row.produto_ativo
      };
    }

    return registro;
  }

  /**
   * Insere uma nova associação.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `
        INSERT INTO miip_associacoes (
          produto_id, origem, fornecedor_cnpj, fornecedor_nome, codigo_fornecedor,
          codigo_barras, nome_item, nome_normalizado, ncm, unidade, score, confianca,
          status, fonte, decisao_operacao_id, confirmado_por_usuario_id, metadados,
          last_used_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        dados.produtoId,
        dados.origem ?? 'manual',
        dados.fornecedorCnpj ?? null,
        dados.fornecedorNome ?? null,
        dados.codigoFornecedor ?? null,
        dados.codigoBarras ?? null,
        dados.nomeItem,
        dados.nomeNormalizado ?? null,
        dados.ncm ?? null,
        dados.unidade ?? null,
        dados.score ?? 0,
        dados.confianca ?? 'NENHUMA',
        dados.status ?? 'ativa',
        dados.fonte ?? 'local',
        dados.decisaoOperacaoId ?? null,
        dados.confirmadoPorUsuarioId ?? null,
        serializarJson(dados.metadados),
        dados.lastUsedAt ?? null
      ]
    );

    return this.buscarPorId(resultado.lastID);
  }

  /**
   * Atualiza uma associação existente.
   *
   * @param {number} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { sets, params } = montarCamposUpdate(dados, MAPA_CAMPOS, (key, value) => {
      if (key === 'metadados') return serializarJson(value);
      return value;
    });

    if (sets.length === 0) {
      return this.buscarPorId(id);
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');

    const resultado = await sql.run(
      `UPDATE miip_associacoes SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id]
    );

    return resultado.changes > 0 ? this.buscarPorId(id) : null;
  }

  /**
   * Busca associação por ID interno.
   *
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_associacoes WHERE id = ? LIMIT 1`,
      [Number(id)]
    );

    return this._mapearRow(row);
  }

  /**
   * Lista associações com filtros estruturais.
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.produtoId != null) {
      where.push('produto_id = ?');
      params.push(Number(filtros.produtoId));
    }
    if (filtros.fornecedorCnpj) {
      where.push('fornecedor_cnpj = ?');
      params.push(filtros.fornecedorCnpj);
    }
    if (filtros.codigoFornecedor) {
      where.push('codigo_fornecedor = ?');
      params.push(filtros.codigoFornecedor);
    }
    if (filtros.codigoBarras) {
      where.push('codigo_barras = ?');
      params.push(filtros.codigoBarras);
    }
    if (filtros.nomeNormalizado) {
      where.push('nome_normalizado = ?');
      params.push(filtros.nomeNormalizado);
    }
    if (filtros.status) {
      where.push('status = ?');
      params.push(filtros.status);
    }
    if (filtros.fonte) {
      where.push('fonte = ?');
      params.push(filtros.fonte);
    }

    const pag = paginacao(filtros);
    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await sql.all(
      `
        SELECT * FROM miip_associacoes
        ${clausulaWhere}
        ORDER BY id DESC
        ${pag.sql}
      `,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Remove associação por ID.
   *
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM miip_associacoes WHERE id = ?`,
      [Number(id)]
    );

    return resultado.changes > 0;
  }

  /**
   * Busca associação ativa por fornecedor e código do item (cProd).
   * Consulta exclusivamente `miip_associacoes` — produto via `ProdutoRepository`.
   *
   * @param {string} fornecedorCnpj
   * @param {string} codigoFornecedor
   * @returns {Promise<Object|null>}
   */
  async buscarPorFornecedorCodigo(fornecedorCnpj, codigoFornecedor) {
    if (!fornecedorCnpj || !codigoFornecedor) return null;

    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `
        SELECT *
        FROM miip_associacoes
        WHERE fornecedor_cnpj = ?
          AND codigo_fornecedor = ?
          AND status = 'ativa'
        LIMIT 1
      `,
      [fornecedorCnpj, codigoFornecedor]
    );

    return this._mapearRow(row);
  }

  /**
   * Busca associações por código de barras.
   *
   * @param {string} codigoBarras
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async buscarPorCodigoBarras(codigoBarras, filtros = {}) {
    if (!codigoBarras) return [];
    return this.listar({ ...filtros, codigoBarras });
  }

  /**
   * Lista associações de um produto.
   *
   * @param {number} produtoId
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async buscarPorProdutoId(produtoId, filtros = {}) {
    if (!produtoId) return [];
    return this.listar({ ...filtros, produtoId: Number(produtoId) });
  }

  /**
   * Marca associação como inativa.
   *
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async inativar(id) {
    const atualizado = await this.atualizar(id, { status: 'inativa' });
    return Boolean(atualizado);
  }

  /**
   * Registra último uso da associação.
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  async registrarUso(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    await sql.run(
      `
        UPDATE miip_associacoes
        SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [Number(id)]
    );
  }

  /**
   * Busca associação por fornecedor + cProd (qualquer status).
   *
   * @param {string} fornecedorCnpj
   * @param {string} codigoFornecedor
   * @returns {Promise<Object|null>}
   */
  async buscarAssociacao(fornecedorCnpj, codigoFornecedor) {
    if (!fornecedorCnpj || !codigoFornecedor) return null;

    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `
        SELECT *
        FROM miip_associacoes
        WHERE fornecedor_cnpj = ?
          AND codigo_fornecedor = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [fornecedorCnpj, codigoFornecedor]
    );

    return this._mapearRow(row);
  }

  /**
   * Cria nova associação de aprendizado confirmada pelo usuário.
   *
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async salvarAssociacao(dados) {
    const agora = new Date().toISOString();
    const usuarioId = dados.confirmadoPorUsuarioId ?? dados.usuarioId ?? null;
    const metadadosBase = dados.metadados && typeof dados.metadados === 'object'
      ? { ...dados.metadados }
      : {};

    return this.inserir({
      ...dados,
      status: dados.status ?? 'ativa',
      confirmadoPorUsuarioId: usuarioId,
      metadados: {
        ...metadadosBase,
        confirmacoes: 1,
        ultima_confirmacao: agora,
        ultimo_usuario: usuarioId
      },
      lastUsedAt: agora
    });
  }

  /**
   * Incrementa contador de confirmações de uma associação existente.
   *
   * @param {number} id
   * @param {Object} [opcoes]
   * @param {number|null} [opcoes.usuarioId]
   * @returns {Promise<Object|null>}
   */
  async incrementarConfirmacoes(id, opcoes = {}) {
    const atual = await this.buscarPorId(id);
    if (!atual) return null;

    const agora = new Date().toISOString();
    const metadados = { ...(atual.metadados || {}) };
    const confirmacoes = Number(metadados.confirmacoes ?? atual.confirmacoes ?? 0) + 1;
    const usuarioId = opcoes.usuarioId ?? atual.confirmadoPorUsuarioId ?? null;

    metadados.confirmacoes = confirmacoes;
    metadados.ultima_confirmacao = agora;
    metadados.ultimo_usuario = usuarioId;

    return this.atualizar(id, {
      confirmadoPorUsuarioId: usuarioId,
      lastUsedAt: agora,
      metadados
    });
  }

  /**
   * Desativa associação (status inativa).
   *
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async desativarAssociacao(id) {
    return this.inativar(id);
  }

  /**
   * Reativa associação previamente inativa.
   *
   * @param {number} id
   * @param {Object} [opcoes]
   * @param {number|null} [opcoes.usuarioId]
   * @returns {Promise<Object|null>}
   */
  async reativarAssociacao(id, opcoes = {}) {
    const agora = new Date().toISOString();
    const atual = await this.buscarPorId(id);
    if (!atual) return null;

    const metadados = { ...(atual.metadados || {}) };
    metadados.reativada_em = agora;
    if (opcoes.usuarioId != null) {
      metadados.ultimo_usuario = opcoes.usuarioId;
    }

    return this.atualizar(id, {
      status: 'ativa',
      confirmadoPorUsuarioId: opcoes.usuarioId ?? atual.confirmadoPorUsuarioId,
      lastUsedAt: agora,
      metadados
    });
  }
}

module.exports = new MiipAssociacoesRepository();
module.exports.MiipAssociacoesRepository = MiipAssociacoesRepository;
