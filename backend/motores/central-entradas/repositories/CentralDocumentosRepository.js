/**
 * CentralDocumentosRepository — Persistência de documentos fiscais do inbox.
 *
 * Tabela: `central_entradas_documentos`
 *
 * @class CentralDocumentosRepository
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
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { CAMPOS_ORDENACAO } = require('../utils/paginacaoCentral');
const { obterPreset } = require('../utils/filtrosRapidosCentral');
const {
  montarClausulaBuscaInteligente,
  apenasDigitos,
  sqlExprCnpjDigitos
} = require('../utils/normalizarBuscaCentral');
const { calcularPrecisaoImportacao } = require('../../miip/utils/miipCentralRevisaoUtils');

const MAPA_CAMPOS = {
  chave: 'chave',
  numero: 'numero',
  serie: 'serie',
  modelo: 'modelo',
  fornecedor: 'fornecedor',
  cnpjFornecedor: 'cnpj_fornecedor',
  dataEmissao: 'data_emissao',
  dataEntrada: 'data_entrada',
  valorTotal: 'valor_total',
  xml: 'xml',
  nsu: 'nsu',
  origem: 'origem',
  status: 'status',
  statusDetalhe: 'status_detalhe',
  tipoDocumento: 'tipo_documento',
  parseJson: 'parse_json',
  miipSessaoId: 'miip_sessao_id',
  miipResumoJson: 'miip_resumo_json',
  compraId: 'compra_id',
  usuarioId: 'usuario_id',
  processadoEm: 'processado_em'
};

class CentralDocumentosRepository extends IRepository {
  /** @readonly */
  static TABELA = 'central_entradas_documentos';

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
    return CentralDocumentosRepository.TABELA;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Persistência de documentos fiscais do inbox da Central de Entradas';
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
      numero: row.numero,
      serie: row.serie,
      modelo: row.modelo,
      fornecedor: row.fornecedor,
      cnpjFornecedor: row.cnpj_fornecedor,
      dataEmissao: row.data_emissao,
      dataEntrada: row.data_entrada,
      valorTotal: row.valor_total,
      xml: row.xml,
      nsu: row.nsu,
      origem: row.origem,
      status: row.status,
      statusDetalhe: row.status_detalhe,
      tipoDocumento: row.tipo_documento || null,
      parseJson: deserializarJson(row.parse_json),
      miipSessaoId: row.miip_sessao_id,
      miipResumoJson: deserializarJson(row.miip_resumo_json),
      compraId: row.compra_id,
      compraTipoEntrada: row.compra_tipo_entrada || null,
      compraTipoEntradaSugerido: row.compra_tipo_entrada_sugerido || null,
      compraTipoEntradaConfianca: row.compra_tipo_entrada_confianca != null
        ? Number(row.compra_tipo_entrada_confianca)
        : null,
      compraTipoEntradaMotivo: row.compra_tipo_entrada_motivo || null,
      compraTipoEntradaAlterado: Number(row.compra_tipo_entrada_alterado) === 1,
      usuarioId: row.usuario_id,
      processadoEm: row.processado_em,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * @private
   * @param {string} camel
   * @param {*} valor
   * @returns {*}
   */
  _transformarCampo(camel, valor) {
    if (camel === 'parseJson' || camel === 'miipResumoJson') {
      return serializarJson(valor);
    }
    return valor;
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT d.*,
              c.tipo_entrada AS compra_tipo_entrada,
              c.tipo_entrada_sugerido AS compra_tipo_entrada_sugerido,
              c.tipo_entrada_confianca AS compra_tipo_entrada_confianca,
              c.tipo_entrada_motivo AS compra_tipo_entrada_motivo,
              c.tipo_entrada_alterado AS compra_tipo_entrada_alterado
       FROM ${CentralDocumentosRepository.TABELA} d
       LEFT JOIN compras c ON c.id = d.compra_id
       WHERE d.id = ?`,
      [id]
    );
    return this._mapearRow(row);
  }

  /**
   * @param {string} chave
   * @returns {Promise<Object|null>}
   */
  async buscarPorChave(chave) {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA} WHERE chave = ?`,
      [chave]
    );
    return this._mapearRow(row);
  }

  /**
   * @private
   * @param {Object} [filtros]
   * @returns {{ clausulaWhere: string, params: *[] }}
   */
  _montarClausulaWhere(filtros = {}) {
    const where = [];
    const params = [];

    if (filtros.status) {
      where.push('status = ?');
      params.push(filtros.status);
    }

    if (filtros.cnpjFornecedor || filtros.cnpj_fornecedor) {
      const cnpj = apenasDigitos(filtros.cnpjFornecedor || filtros.cnpj_fornecedor);
      where.push(`${sqlExprCnpjDigitos('cnpj_fornecedor')} = ?`);
      params.push(cnpj);
    }

    if (filtros.origem) {
      where.push('origem = ?');
      params.push(filtros.origem);
    }

    // RC3.6.C — busca inteligente (CNPJ máscara, zeros NF, &amp;, acentos)
    if (filtros.busca) {
      const clausulaBusca = montarClausulaBuscaInteligente(filtros.busca);
      if (clausulaBusca) {
        where.push(clausulaBusca.sql);
        params.push(...clausulaBusca.params);
      }
    }

    if (filtros.dataEmissaoInicio || filtros.data_emissao_inicio) {
      where.push("data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND date(data_emissao) >= date(?)");
      params.push(filtros.dataEmissaoInicio || filtros.data_emissao_inicio);
    }

    if (filtros.dataEmissaoFim || filtros.data_emissao_fim) {
      where.push("data_emissao IS NOT NULL AND TRIM(data_emissao) != '' AND date(data_emissao) <= date(?)");
      params.push(filtros.dataEmissaoFim || filtros.data_emissao_fim);
    }

    if (filtros.createdAtInicio || filtros.created_at_inicio) {
      where.push('date(created_at) >= date(?)');
      params.push(filtros.createdAtInicio || filtros.created_at_inicio);
    }

    if (filtros.createdAtFim || filtros.created_at_fim) {
      where.push('date(created_at) <= date(?)');
      params.push(filtros.createdAtFim || filtros.created_at_fim);
    }

    const statusIn = filtros.statusIn || filtros.status_in;
    if (Array.isArray(statusIn) && statusIn.length) {
      where.push(`status IN (${statusIn.map(() => '?').join(', ')})`);
      params.push(...statusIn);
    }

    const preset = filtros.filtroRapido || filtros.filtro_rapido;
    if (preset) {
      const meta = obterPreset(preset);
      if (meta?.sql) {
        where.push(meta.sql);
      }
      if (meta?.statusIn?.length) {
        where.push(`status IN (${meta.statusIn.map(() => '?').join(', ')})`);
        params.push(...meta.statusIn);
      }
    }

    return {
      clausulaWhere: where.length ? `WHERE ${where.join(' AND ')}` : '',
      params
    };
  }

  /**
   * @private
   * @param {Object} [filtros]
   * @returns {string}
   */
  _montarOrderBy(filtros = {}) {
    const campo = CAMPOS_ORDENACAO[filtros.ordenarPor] || CAMPOS_ORDENACAO.created_at;
    const direcao = String(filtros.ordenarDirecao || 'DESC').toUpperCase() === 'ASC'
      ? 'ASC'
      : 'DESC';
    return `ORDER BY ${campo} ${direcao}, id DESC`;
  }

  /**
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarPendentesProcessamento(limite = 100) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE status = ?
         AND (parse_json IS NULL OR parse_json = '')
       ORDER BY created_at ASC
       LIMIT ?`,
      [DocumentoFiscalStatus.SINCRONIZADA, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Colunas para listagem (sem XML/parse pesado).
   * @private
   */
  static get COLUNAS_LISTAGEM() {
    return `id, chave, numero, serie, modelo, fornecedor, cnpj_fornecedor,
      data_emissao, data_entrada, valor_total, nsu, origem, status, status_detalhe, tipo_documento,
      miip_sessao_id, miip_resumo_json, compra_id, usuario_id, processado_em, created_at, updated_at,
      CASE WHEN tipo_documento IN ('PROC_NFE', 'NFE') THEN 1 ELSE 0 END AS xml_completo_flag,
      CASE
        WHEN parse_json IS NOT NULL AND TRIM(parse_json) != '' THEN 1
        WHEN tipo_documento IN ('PROC_NFE', 'NFE') THEN 1
        ELSE 0
      END AS parse_disponivel_flag`;
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { clausulaWhere, params } = this._montarClausulaWhere(filtros);
    const orderBy = this._montarOrderBy(filtros);
    const pag = paginacao(filtros);

    const rows = await sql.all(
      `SELECT ${CentralDocumentosRepository.COLUNAS_LISTAGEM}
       FROM ${CentralDocumentosRepository.TABELA} ${clausulaWhere} ${orderBy}${pag.sql}`,
      [...params, ...pag.params]
    );

    if (filtros.busca) {
      const metaBusca = montarClausulaBuscaInteligente(filtros.busca);
      console.log('[Central Entradas][BUSCA]', JSON.stringify({
        pesquisa: String(filtros.busca || '').trim(),
        normalizado: metaBusca?.meta || null,
        filtros: {
          status: filtros.status || null,
          origem: filtros.origem || null,
          filtroRapido: filtros.filtroRapido || filtros.filtro_rapido || null,
          dataEmissaoInicio: filtros.dataEmissaoInicio || filtros.data_emissao_inicio || null,
          dataEmissaoFim: filtros.dataEmissaoFim || filtros.data_emissao_fim || null
        },
        where: clausulaWhere,
        params,
        quantidadeRetornada: rows.length
      }));
    }

    return rows.map((row) => this._mapearRowListagem(row));
  }

  /**
   * @private
   * @param {Object|null} row
   * @returns {Object|null}
   */
  _mapearRowListagem(row) {
    if (!row) return null;

    const xmlCompleto = Number(row.xml_completo_flag) === 1
      || ['PROC_NFE', 'NFE'].includes(String(row.tipo_documento || '').toUpperCase());
    const parseDisponivel = Number(row.parse_disponivel_flag) === 1 || xmlCompleto;

    return {
      id: row.id,
      chave: row.chave,
      numero: row.numero,
      serie: row.serie,
      modelo: row.modelo,
      fornecedor: row.fornecedor,
      cnpjFornecedor: row.cnpj_fornecedor,
      dataEmissao: row.data_emissao,
      dataEntrada: row.data_entrada,
      valorTotal: row.valor_total,
      nsu: row.nsu,
      origem: row.origem,
      status: row.status,
      statusDetalhe: row.status_detalhe,
      tipoDocumento: row.tipo_documento || null,
      miipSessaoId: row.miip_sessao_id,
      miipResumoJson: deserializarJson(row.miip_resumo_json),
      compraId: row.compra_id,
      usuarioId: row.usuario_id,
      processadoEm: row.processado_em,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      parseJson: null,
      xml: null,
      xmlDisponivel: xmlCompleto,
      parseDisponivel,
      /** Sentinel RC3.7.1 — listagem não carrega parse_json; flag indica XML completo / parseável */
      _parseDisponivelListagem: parseDisponivel
    };
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listarComXml(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { clausulaWhere, params } = this._montarClausulaWhere(filtros);
    const orderBy = this._montarOrderBy(filtros);
    const pag = paginacao(filtros);

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA} ${clausulaWhere} ${orderBy}${pag.sql}`,
      [...params, ...pag.params]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Estatísticas agregadas para o dashboard (somente leitura).
   *
   * @returns {Promise<{ totalDocumentos: number, valorTotalDia: number, documentosHoje: number }>}
   */
  async obterEstatisticas() {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT
         COUNT(*) AS total_documentos,
         COALESCE(SUM(CASE
           WHEN data_emissao IS NOT NULL AND TRIM(data_emissao) != ''
            AND date(data_emissao) = date('now', 'localtime')
           THEN valor_total ELSE 0 END), 0) AS valor_total_dia,
         COALESCE(SUM(CASE
           WHEN data_emissao IS NOT NULL AND TRIM(data_emissao) != ''
            AND date(data_emissao) = date('now', 'localtime')
           THEN 1 ELSE 0 END), 0) AS documentos_hoje
       FROM ${CentralDocumentosRepository.TABELA}`
    );

    return {
      totalDocumentos: Number(row?.total_documentos || 0),
      valorTotalDia: Number(row?.valor_total_dia || 0),
      documentosHoje: Number(row?.documentos_hoje || 0)
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
      `INSERT INTO ${CentralDocumentosRepository.TABELA} (
        chave, numero, serie, modelo, fornecedor, cnpj_fornecedor,
        data_emissao, data_entrada, valor_total, xml, nsu, origem,
        status, status_detalhe, tipo_documento, parse_json, miip_sessao_id, miip_resumo_json,
        compra_id, usuario_id, processado_em, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        dados.chave,
        dados.numero ?? null,
        dados.serie ?? null,
        dados.modelo ?? '55',
        dados.fornecedor ?? null,
        dados.cnpjFornecedor ?? dados.cnpj_fornecedor ?? null,
        dados.dataEmissao ?? dados.data_emissao ?? null,
        dados.dataEntrada ?? dados.data_entrada ?? null,
        dados.valorTotal ?? dados.valor_total ?? null,
        dados.xml,
        dados.nsu ?? null,
        dados.origem ?? 'dfe',
        dados.status ?? DocumentoFiscalStatus.RECEBIDA,
        dados.statusDetalhe ?? dados.status_detalhe ?? null,
        dados.tipoDocumento ?? dados.tipo_documento ?? null,
        serializarJson(dados.parseJson ?? dados.parse_json),
        dados.miipSessaoId ?? dados.miip_sessao_id ?? null,
        serializarJson(dados.miipResumoJson ?? dados.miip_resumo_json),
        dados.compraId ?? dados.compra_id ?? null,
        dados.usuarioId ?? dados.usuario_id ?? null,
        dados.processadoEm ?? dados.processado_em ?? null
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

    const { sets, params } = montarCamposUpdate(dados, MAPA_CAMPOS, (camel, valor) => {
      return this._transformarCampo(camel, valor);
    });

    if (!sets.length) {
      return this.buscarPorId(id);
    }

    sets.push("updated_at = datetime('now')");

    await sql.run(
      `UPDATE ${CentralDocumentosRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
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
      `DELETE FROM ${CentralDocumentosRepository.TABELA} WHERE id = ?`,
      [id]
    );

    return resultado.changes > 0;
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<number>}
   */
  async contar(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { clausulaWhere, params } = this._montarClausulaWhere(filtros);

    const row = await sql.get(
      `SELECT COUNT(*) AS total FROM ${CentralDocumentosRepository.TABELA} ${clausulaWhere}`,
      params
    );

    return Number(row?.total || 0);
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Record<string, number>>}
   */
  async contarPorStatus(filtros = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const { clausulaWhere, params } = this._montarClausulaWhere(filtros);

    const rows = await sql.all(
      `SELECT status, COUNT(*) AS total
       FROM ${CentralDocumentosRepository.TABELA}
       ${clausulaWhere}
       GROUP BY status`,
      params
    );

    const contadores = {};
    rows.forEach((row) => {
      contadores[row.status] = Number(row.total || 0);
    });

    return contadores;
  }

  /**
   * @param {string} status
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarPorStatus(status, limite = 50) {
    return this.listar({ status, limite, ordenarPor: 'created_at', ordenarDirecao: 'ASC' });
  }

  /**
   * Fornecedores com exatamente uma nota na Central (primeira nota).
   *
   * @returns {Promise<Object[]>}
   */
  async listarFornecedoresNovos() {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT d.*
       FROM ${CentralDocumentosRepository.TABELA} d
       INNER JOIN (
         SELECT cnpj_fornecedor, COUNT(*) AS total
         FROM ${CentralDocumentosRepository.TABELA}
         WHERE cnpj_fornecedor IS NOT NULL AND cnpj_fornecedor != ''
         GROUP BY cnpj_fornecedor
         HAVING total = 1
       ) novos ON novos.cnpj_fornecedor = d.cnpj_fornecedor
       WHERE d.created_at >= datetime('now', 'localtime', '-30 days')
       ORDER BY d.created_at DESC
       LIMIT 20`
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {number} multiplicador
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarValorAcimaMediaFornecedor(multiplicador = 2, limite = 20) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT d.*
       FROM ${CentralDocumentosRepository.TABELA} d
       INNER JOIN (
         SELECT cnpj_fornecedor, AVG(valor_total) AS media_valor
         FROM ${CentralDocumentosRepository.TABELA}
         WHERE cnpj_fornecedor IS NOT NULL AND valor_total > 0
         GROUP BY cnpj_fornecedor
         HAVING COUNT(*) >= 2
       ) med ON med.cnpj_fornecedor = d.cnpj_fornecedor
       WHERE d.valor_total > (med.media_valor * ?)
         AND d.status NOT IN (?, ?)
       ORDER BY d.valor_total DESC
       LIMIT ?`,
      [multiplicador, DocumentoFiscalStatus.GRAVADA, DocumentoFiscalStatus.DUPLICADA, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {number} dias
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarRevisaoParada(dias = 3, limite = 50) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE status = ?
         AND datetime(COALESCE(processado_em, created_at)) <= datetime('now', 'localtime', ? || ' days')
       ORDER BY created_at ASC
       LIMIT ?`,
      [DocumentoFiscalStatus.AGUARDANDO_REVISAO, `-${Number(dias)}`, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {number} dias
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarSincronizadasNaoProcessadas(dias = 1, limite = 50) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE status = ?
         AND processado_em IS NULL
         AND datetime(created_at) <= datetime('now', 'localtime', ? || ' days')
       ORDER BY created_at ASC
       LIMIT ?`,
      [DocumentoFiscalStatus.SINCRONIZADA, `-${Number(dias)}`, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarComprasAbertas(limite = 50) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE status = ? AND (compra_id IS NULL OR compra_id = '')
       ORDER BY updated_at DESC
       LIMIT ?`,
      [DocumentoFiscalStatus.EM_COMPRA, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {number} [limite]
   * @returns {Promise<Object[]>}
   */
  async listarXmlInvalido(limite = 50) {
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE status = ?
         AND (
           LOWER(COALESCE(status_detalhe, '')) LIKE '%xml%'
           OR LOWER(COALESCE(status_detalhe, '')) LIKE '%parse%'
           OR xml IS NULL OR xml = ''
         )
       ORDER BY updated_at DESC
       LIMIT ?`,
      [DocumentoFiscalStatus.ERRO, limite]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * @param {string} cnpj
   * @param {Object} [opcoes]
   * @returns {Promise<Object[]>}
   */
  async listarPorFornecedor(cnpj, opcoes = {}) {
    const periodoDias = Number(opcoes.periodoDias ?? 90) || 90;
    const sql = this._obterSql();
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE cnpj_fornecedor = ?
         AND created_at >= datetime('now', 'localtime', ? || ' days')
       ORDER BY created_at DESC`,
      [cnpj, `-${periodoDias}`]
    );

    return rows.map((row) => this._mapearRow(row));
  }

  /**
   * Métricas operacionais agregadas (somente leitura).
   *
   * @param {Object} [opcoes] — { ano, mes, competencia }
   * @returns {Promise<Object>}
   */
  async obterMetricasOperacionais(opcoes = {}) {
    const sql = this._obterSql();
    await sql.whenReady();

    const indicadoresFiscaisService = require('../../../services/IndicadoresFiscaisService');
    const indicadores = await indicadoresFiscaisService.obterIndicadoresCentral(opcoes);

    const row = await sql.get(
      `SELECT
         AVG(CASE
           WHEN processado_em IS NOT NULL AND created_at IS NOT NULL
           THEN (julianday(processado_em) - julianday(created_at)) * 24 * 60
           ELSE NULL END) AS tempo_medio_minutos,
         COALESCE(SUM(CASE
           WHEN status = ? AND date(updated_at) = date('now', 'localtime')
           THEN 1 ELSE 0 END), 0) AS compras_concluidas_hoje
       FROM ${CentralDocumentosRepository.TABELA}`,
      [DocumentoFiscalStatus.GRAVADA]
    );

    const comMiip = await sql.all(
      `SELECT miip_resumo_json, status FROM ${CentralDocumentosRepository.TABELA}
       WHERE miip_resumo_json IS NOT NULL AND miip_resumo_json != ''`
    );

    let somaIdentificacao = 0;
    let contIdentificacao = 0;
    let totalRevisaoManual = 0;
    let totalProcessados = 0;

    comMiip.forEach((docRow) => {
      try {
        const resumo = JSON.parse(docRow.miip_resumo_json)?.resumo;
        if (!resumo?.totalItens) return;

        totalProcessados += 1;
        somaIdentificacao += calcularPrecisaoImportacao(resumo);
        contIdentificacao += 1;

        const precisam = Number(resumo.precisamConfirmacao ?? 0)
          + Number(resumo.precisamCadastro ?? 0);
        if (precisam > 0 || docRow.status === DocumentoFiscalStatus.AGUARDANDO_REVISAO) {
          totalRevisaoManual += 1;
        }
      } catch {
        /* ignora JSON inválido */
      }
    });

    return {
      valorTotalMes: Number(indicadores.valorMensal || 0),
      valorMensal: Number(indicadores.valorMensal || 0),
      valorAnual: Number(indicadores.valorAnual || 0),
      quantidadeMensal: Number(indicadores.quantidadeMensal || 0),
      quantidadeAnual: Number(indicadores.quantidadeAnual || 0),
      competencia: indicadores.competencia,
      competenciaLabel: indicadores.competenciaLabel,
      ambiente: indicadores.ambiente,
      ambienteLabel: indicadores.ambienteLabel,
      tempoMedioProcessamentoMinutos: row?.tempo_medio_minutos != null
        ? Math.round(Number(row.tempo_medio_minutos))
        : null,
      taxaIdentificacaoAutomatica: contIdentificacao > 0
        ? Math.round(somaIdentificacao / contIdentificacao)
        : null,
      taxaRevisaoManual: totalProcessados > 0
        ? Math.round((totalRevisaoManual / totalProcessados) * 100)
        : null,
      comprasConcluidasHoje: Number(row?.compras_concluidas_hoje || 0)
    };
  }
}

module.exports = CentralDocumentosRepository;
