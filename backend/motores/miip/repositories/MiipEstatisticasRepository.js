/**
 * MiipEstatisticasRepository — Persistência de agregados e métricas do MIIP.
 *
 * @deprecated RC1 — Não participa do runtime. Agregados operacionais usam
 * `MiipDecisoesRepository.agregarEstatisticas()` e telemetria in-memory.
 * Reservado para futura evolução do MIIP V2.
 *
 * Tabela: `miip_estatisticas`
 *
 * @class MiipEstatisticasRepository
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
  escopo: 'escopo',
  chave: 'chave',
  periodoTipo: 'periodo_tipo',
  periodoInicio: 'periodo_inicio',
  periodoFim: 'periodo_fim',
  totalDecisoes: 'total_decisoes',
  totalAutoVinculadas: 'total_auto_vinculadas',
  totalSugestoes: 'total_sugestoes',
  totalCriadosNovos: 'total_criados_novos',
  totalRevisaoManual: 'total_revisao_manual',
  totalFeedbacks: 'total_feedbacks',
  totalAcertos: 'total_acertos',
  totalErros: 'total_erros',
  confiancaAlta: 'confianca_alta',
  confiancaMedia: 'confianca_media',
  confiancaBaixa: 'confianca_baixa',
  confiancaNenhuma: 'confianca_nenhuma',
  scoreMedio: 'score_medio',
  tempoMedioMs: 'tempo_medio_ms',
  metadados: 'metadados'
};

class MiipEstatisticasRepository extends IRepository {
  /** @readonly */
  static TABELA = 'miip_estatisticas';

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
    return MiipEstatisticasRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Persistência de agregados e métricas de desempenho';
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
      escopo: row.escopo,
      chave: row.chave,
      periodoTipo: row.periodo_tipo,
      periodoInicio: row.periodo_inicio,
      periodoFim: row.periodo_fim,
      totalDecisoes: row.total_decisoes,
      totalAutoVinculadas: row.total_auto_vinculadas,
      totalSugestoes: row.total_sugestoes,
      totalCriadosNovos: row.total_criados_novos,
      totalRevisaoManual: row.total_revisao_manual,
      totalFeedbacks: row.total_feedbacks,
      totalAcertos: row.total_acertos,
      totalErros: row.total_erros,
      confiancaAlta: row.confianca_alta,
      confiancaMedia: row.confianca_media,
      confiancaBaixa: row.confianca_baixa,
      confiancaNenhuma: row.confianca_nenhuma,
      scoreMedio: row.score_medio,
      tempoMedioMs: row.tempo_medio_ms,
      metadados: deserializarJson(row.metadados),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Insere um registro de estatística.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async inserir(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `
        INSERT INTO miip_estatisticas (
          escopo, chave, periodo_tipo, periodo_inicio, periodo_fim,
          total_decisoes, total_auto_vinculadas, total_sugestoes, total_criados_novos,
          total_revisao_manual, total_feedbacks, total_acertos, total_erros,
          confianca_alta, confianca_media, confianca_baixa, confianca_nenhuma,
          score_medio, tempo_medio_ms, metadados, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        dados.escopo,
        dados.chave,
        dados.periodoTipo ?? 'diario',
        dados.periodoInicio,
        dados.periodoFim ?? null,
        dados.totalDecisoes ?? 0,
        dados.totalAutoVinculadas ?? 0,
        dados.totalSugestoes ?? 0,
        dados.totalCriadosNovos ?? 0,
        dados.totalRevisaoManual ?? 0,
        dados.totalFeedbacks ?? 0,
        dados.totalAcertos ?? 0,
        dados.totalErros ?? 0,
        dados.confiancaAlta ?? 0,
        dados.confiancaMedia ?? 0,
        dados.confiancaBaixa ?? 0,
        dados.confiancaNenhuma ?? 0,
        dados.scoreMedio ?? 0,
        dados.tempoMedioMs ?? 0,
        serializarJson(dados.metadados)
      ]
    );

    return this.buscarPorId(resultado.lastID);
  }

  /**
   * Atualiza um registro de estatística.
   *
   * @param {number|string} id
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
      `UPDATE miip_estatisticas SET ${sets.join(', ')} WHERE id = ?`,
      [...params, Number(id)]
    );

    return resultado.changes > 0 ? this.buscarPorId(id) : null;
  }

  /**
   * Busca estatística por ID interno.
   *
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM miip_estatisticas WHERE id = ? LIMIT 1`,
      [Number(id)]
    );

    return this._mapearRow(row);
  }

  /**
   * Busca estatística por escopo, chave e período.
   *
   * @param {string} escopo
   * @param {string} chave
   * @param {string} periodoTipo
   * @param {string} periodoInicio
   * @returns {Promise<Object|null>}
   */
  async buscarPorEscopoPeriodo(escopo, chave, periodoTipo, periodoInicio) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `
        SELECT * FROM miip_estatisticas
        WHERE escopo = ? AND chave = ? AND periodo_tipo = ? AND periodo_inicio = ?
        LIMIT 1
      `,
      [escopo, chave, periodoTipo, periodoInicio]
    );

    return this._mapearRow(row);
  }

  /**
   * Lista estatísticas com filtros estruturais.
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.escopo) {
      where.push('escopo = ?');
      params.push(filtros.escopo);
    }
    if (filtros.chave) {
      where.push('chave = ?');
      params.push(filtros.chave);
    }
    if (filtros.periodoTipo) {
      where.push('periodo_tipo = ?');
      params.push(filtros.periodoTipo);
    }
    if (filtros.periodoInicio) {
      where.push('periodo_inicio = ?');
      params.push(filtros.periodoInicio);
    }
    if (filtros.periodoFim) {
      where.push('periodo_fim = ?');
      params.push(filtros.periodoFim);
    }

    const pag = paginacao(filtros);
    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await sql.all(
      `
        SELECT * FROM miip_estatisticas
        ${clausulaWhere}
        ORDER BY periodo_inicio DESC, id DESC
        ${pag.sql}
      `,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Remove estatística por ID.
   *
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const resultado = await sql.run(
      `DELETE FROM miip_estatisticas WHERE id = ?`,
      [Number(id)]
    );

    return resultado.changes > 0;
  }

  /**
   * Retorna resumo consolidado de métricas (agregação SQL).
   *
   * @param {Object} [filtros]
   * @returns {Promise<Object>}
   */
  async resumo(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const where = [];
    const params = [];

    if (filtros.escopo) {
      where.push('escopo = ?');
      params.push(filtros.escopo);
    }
    if (filtros.chave) {
      where.push('chave = ?');
      params.push(filtros.chave);
    }
    if (filtros.periodoTipo) {
      where.push('periodo_tipo = ?');
      params.push(filtros.periodoTipo);
    }
    if (filtros.periodoInicio) {
      where.push('periodo_inicio >= ?');
      params.push(filtros.periodoInicio);
    }
    if (filtros.periodoFim) {
      where.push('periodo_inicio <= ?');
      params.push(filtros.periodoFim);
    }

    const clausulaWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const row = await sql.get(
      `
        SELECT
          COALESCE(SUM(total_decisoes), 0) AS total_decisoes,
          COALESCE(SUM(total_auto_vinculadas), 0) AS total_auto_vinculadas,
          COALESCE(SUM(total_sugestoes), 0) AS total_sugestoes,
          COALESCE(SUM(total_criados_novos), 0) AS total_criados_novos,
          COALESCE(SUM(total_revisao_manual), 0) AS total_revisao_manual,
          COALESCE(SUM(total_feedbacks), 0) AS total_feedbacks,
          COALESCE(SUM(total_acertos), 0) AS total_acertos,
          COALESCE(SUM(total_erros), 0) AS total_erros,
          COALESCE(AVG(score_medio), 0) AS score_medio,
          COALESCE(AVG(tempo_medio_ms), 0) AS tempo_medio_ms
        FROM miip_estatisticas
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
   * Insere ou atualiza estatística por chave de período.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async upsert(dados) {
    const sql = this._obterSql();
    await sql.whenReady();

    await sql.run(
      `
        INSERT INTO miip_estatisticas (
          escopo, chave, periodo_tipo, periodo_inicio, periodo_fim,
          total_decisoes, total_auto_vinculadas, total_sugestoes, total_criados_novos,
          total_revisao_manual, total_feedbacks, total_acertos, total_erros,
          confianca_alta, confianca_media, confianca_baixa, confianca_nenhuma,
          score_medio, tempo_medio_ms, metadados, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(escopo, chave, periodo_tipo, periodo_inicio) DO UPDATE SET
          periodo_fim = excluded.periodo_fim,
          total_decisoes = excluded.total_decisoes,
          total_auto_vinculadas = excluded.total_auto_vinculadas,
          total_sugestoes = excluded.total_sugestoes,
          total_criados_novos = excluded.total_criados_novos,
          total_revisao_manual = excluded.total_revisao_manual,
          total_feedbacks = excluded.total_feedbacks,
          total_acertos = excluded.total_acertos,
          total_erros = excluded.total_erros,
          confianca_alta = excluded.confianca_alta,
          confianca_media = excluded.confianca_media,
          confianca_baixa = excluded.confianca_baixa,
          confianca_nenhuma = excluded.confianca_nenhuma,
          score_medio = excluded.score_medio,
          tempo_medio_ms = excluded.tempo_medio_ms,
          metadados = excluded.metadados,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        dados.escopo,
        dados.chave,
        dados.periodoTipo ?? 'diario',
        dados.periodoInicio,
        dados.periodoFim ?? null,
        dados.totalDecisoes ?? 0,
        dados.totalAutoVinculadas ?? 0,
        dados.totalSugestoes ?? 0,
        dados.totalCriadosNovos ?? 0,
        dados.totalRevisaoManual ?? 0,
        dados.totalFeedbacks ?? 0,
        dados.totalAcertos ?? 0,
        dados.totalErros ?? 0,
        dados.confiancaAlta ?? 0,
        dados.confiancaMedia ?? 0,
        dados.confiancaBaixa ?? 0,
        dados.confiancaNenhuma ?? 0,
        dados.scoreMedio ?? 0,
        dados.tempoMedioMs ?? 0,
        serializarJson(dados.metadados)
      ]
    );

    return this.buscarPorEscopoPeriodo(
      dados.escopo,
      dados.chave,
      dados.periodoTipo ?? 'diario',
      dados.periodoInicio
    );
  }
}

module.exports = new MiipEstatisticasRepository();
module.exports.MiipEstatisticasRepository = MiipEstatisticasRepository;
