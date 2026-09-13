/**
 * MiipDecisoesRepository — Persistência de decisões de identificação.
 *
 * Tabela: `miip_decisoes`
 * Sprint 2.1: CRUD e consultas — sem regra de negócio.
 *
 * @class MiipDecisoesRepository
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
  operacaoId: 'operacao_id',
  origem: 'origem',
  itemHash: 'item_hash',
  itemSnapshot: 'item_snapshot',
  contextoSnapshot: 'contexto_snapshot',
  candidatosSnapshot: 'candidatos_snapshot',
  motoresSnapshot: 'motores_snapshot',
  produtoSugeridoId: 'produto_sugerido_id',
  produtoDecididoId: 'produto_decidido_id',
  acaoRecomendada: 'acao_recomendada',
  confianca: 'confianca',
  scoreFinal: 'score_final',
  scoreGap: 'score_gap',
  conflito: 'conflito',
  feedbackStatus: 'feedback_status',
  usuarioId: 'usuario_id',
  duracaoTotalMs: 'duracao_total_ms',
  erro: 'erro',
  metadados: 'metadados',
  decidedAt: 'decided_at'
};

const CAMPOS_JSON = new Set([
  'itemSnapshot',
  'contextoSnapshot',
  'candidatosSnapshot',
  'motoresSnapshot',
  'metadados'
]);

class MiipDecisoesRepository extends IRepository {
  /** @readonly */
  static TABELA = 'miip_decisoes';

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
    return MiipDecisoesRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Persistência de decisões auditáveis de identificação';
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
      operacaoId: row.operacao_id,
      origem: row.origem,
      itemHash: row.item_hash,
      itemSnapshot: deserializarJson(row.item_snapshot),
      contextoSnapshot: deserializarJson(row.contexto_snapshot),
      candidatosSnapshot: deserializarJson(row.candidatos_snapshot),
      motoresSnapshot: deserializarJson(row.motores_snapshot),
      produtoSugeridoId: row.produto_sugerido_id,
      produtoDecididoId: row.produto_decidido_id,
      acaoRecomendada: row.acao_recomendada,
      confianca: row.confianca,
      scoreFinal: row.score_final,
      scoreGap: row.score_gap,
      conflito: row.conflito === 1,
      feedbackStatus: row.feedback_status,
      usuarioId: row.usuario_id,
      duracaoTotalMs: row.duracao_total_ms,
      erro: row.erro,
      metadados: deserializarJson(row.metadados),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      decidedAt: row.decided_at
    };
  }

  /**
   * Insere uma nova decisão de identificação.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `
        INSERT INTO miip_decisoes (
          operacao_id, origem, item_hash, item_snapshot, contexto_snapshot,
          candidatos_snapshot, motores_snapshot, produto_sugerido_id, produto_decidido_id,
          acao_recomendada, confianca, score_final, score_gap, conflito, feedback_status,
          usuario_id, duracao_total_ms, erro, metadados, decided_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        dados.operacaoId,
        dados.origem ?? 'indefinida',
        dados.itemHash ?? null,
        serializarJson(dados.itemSnapshot),
        serializarJson(dados.contextoSnapshot),
        serializarJson(dados.candidatosSnapshot),
        serializarJson(dados.motoresSnapshot),
        dados.produtoSugeridoId ?? null,
        dados.produtoDecididoId ?? null,
        dados.acaoRecomendada ?? null,
        dados.confianca ?? null,
        dados.scoreFinal ?? 0,
        dados.scoreGap ?? null,
        dados.conflito ? 1 : 0,
        dados.feedbackStatus ?? 'pendente',
        dados.usuarioId ?? null,
        dados.duracaoTotalMs ?? 0,
        dados.erro ?? null,
        serializarJson(dados.metadados),
        dados.decidedAt ?? null
      ]
    );

    return this.buscarPorId(resultado.lastID);
  }

  /**
   * Atualiza uma decisão existente.
   *
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { sets, params } = montarCamposUpdate(dados, MAPA_CAMPOS, (key, value) => {
      if (key === 'conflito') return value ? 1 : 0;
      if (CAMPOS_JSON.has(key)) return serializarJson(value);
      return value;
    });

    if (sets.length === 0) {
      return this.buscarPorId(id);
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');

    const resultado = await sql.run(
      `UPDATE miip_decisoes SET ${sets.join(', ')} WHERE id = ?`,
      [...params, Number(id)]
    );

    return resultado.changes > 0 ? this.buscarPorId(id) : null;
  }

  /**
   * Busca decisão por ID interno.
   *
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_decisoes WHERE id = ? LIMIT 1`,
      [Number(id)]
    );

    return this._mapearRow(row);
  }

  /**
   * Busca decisão por operacao_id (UUID público).
   *
   * @param {string} operacaoId
   * @returns {Promise<Object|null>}
   */
  async buscarPorOperacaoId(operacaoId) {
    if (!operacaoId) return null;

    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_decisoes WHERE operacao_id = ? LIMIT 1`,
      [String(operacaoId)]
    );

    return this._mapearRow(row);
  }

  /**
   * Agrega estatísticas a partir das decisões persistidas.
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object>}
   */
  async agregarEstatisticas(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.origem) {
      where.push('origem = ?');
      params.push(filtros.origem);
    }
    if (filtros.dataInicio) {
      where.push('created_at >= ?');
      params.push(filtros.dataInicio);
    }
    if (filtros.dataFim) {
      where.push('created_at <= ?');
      params.push(filtros.dataFim);
    }

    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const row = await sql.get(
      `
        SELECT
          COUNT(*) AS total_decisoes,
          SUM(CASE WHEN acao_recomendada = 'auto_vincular' THEN 1 ELSE 0 END) AS total_auto_vinculadas,
          SUM(CASE WHEN acao_recomendada = 'sugerir' THEN 1 ELSE 0 END) AS total_sugestoes,
          SUM(CASE WHEN acao_recomendada = 'criar_novo' THEN 1 ELSE 0 END) AS total_criados_novos,
          SUM(CASE WHEN acao_recomendada = 'revisar_manual' THEN 1 ELSE 0 END) AS total_revisao_manual,
          SUM(CASE WHEN feedback_status = 'confirmado' THEN 1 ELSE 0 END) AS total_feedbacks,
          SUM(CASE WHEN feedback_status = 'confirmado' AND produto_decidido_id = produto_sugerido_id THEN 1 ELSE 0 END) AS total_acertos,
          SUM(CASE WHEN feedback_status = 'rejeitado' THEN 1 ELSE 0 END) AS total_erros,
          COALESCE(AVG(score_final), 0) AS score_medio,
          COALESCE(AVG(duracao_total_ms), 0) AS tempo_medio_ms
        FROM miip_decisoes
        ${clausulaWhere}
      `,
      params
    );

    return {
      totalDecisoes: row?.total_decisoes ?? 0,
      totalAutoVinculadas: row?.total_auto_vinculadas ?? 0,
      totalSugestoes: row?.total_sugestoes ?? 0,
      totalCriadosNovos: row?.total_criados_novos ?? 0,
      totalRevisaoManual: row?.total_revisao_manual ?? 0,
      totalFeedbacks: row?.total_feedbacks ?? 0,
      totalAcertos: row?.total_acertos ?? 0,
      totalErros: row?.total_erros ?? 0,
      scoreMedio: row?.score_medio ?? 0,
      tempoMedioMs: row?.tempo_medio_ms ?? 0
    };
  }

  /**
   * Lista decisões com filtros estruturais.
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.origem) {
      where.push('origem = ?');
      params.push(filtros.origem);
    }
    if (filtros.confianca) {
      where.push('confianca = ?');
      params.push(filtros.confianca);
    }
    if (filtros.acaoRecomendada) {
      where.push('acao_recomendada = ?');
      params.push(filtros.acaoRecomendada);
    }
    if (filtros.produtoDecididoId != null) {
      where.push('produto_decidido_id = ?');
      params.push(Number(filtros.produtoDecididoId));
    }
    if (filtros.itemHash) {
      where.push('item_hash = ?');
      params.push(filtros.itemHash);
    }
    if (filtros.feedbackStatus) {
      where.push('feedback_status = ?');
      params.push(filtros.feedbackStatus);
    }
    if (filtros.dataInicio) {
      where.push('created_at >= ?');
      params.push(filtros.dataInicio);
    }
    if (filtros.dataFim) {
      where.push('created_at <= ?');
      params.push(filtros.dataFim);
    }

    const pag = paginacao(filtros);
    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await sql.all(
      `
        SELECT * FROM miip_decisoes
        ${clausulaWhere}
        ORDER BY created_at DESC, id DESC
        ${pag.sql}
      `,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Remove decisão por ID.
   *
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM miip_decisoes WHERE id = ?`,
      [Number(id)]
    );

    return resultado.changes > 0;
  }

  /**
   * Atualiza status de feedback de uma decisão.
   *
   * @param {string} operacaoId
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizarFeedback(operacaoId, dados) {
    const existente = await this.buscarPorOperacaoId(operacaoId);
    if (!existente) return null;

    return this.atualizar(existente.id, {
      feedbackStatus: dados.feedbackStatus,
      produtoDecididoId: dados.produtoDecididoId,
      usuarioId: dados.usuarioId,
      metadados: dados.metadados,
      decidedAt: dados.decidedAt ?? new Date().toISOString()
    });
  }

  /**
   * Registra produto final decidido para uma operação.
   *
   * @param {string} operacaoId
   * @param {number} produtoDecididoId
   * @returns {Promise<Object|null>}
   */
  async atualizarProdutoDecidido(operacaoId, produtoDecididoId) {
    const existente = await this.buscarPorOperacaoId(operacaoId);
    if (!existente) return null;

    return this.atualizar(existente.id, {
      produtoDecididoId: Number(produtoDecididoId),
      decidedAt: new Date().toISOString()
    });
  }
}

module.exports = new MiipDecisoesRepository();
module.exports.MiipDecisoesRepository = MiipDecisoesRepository;
