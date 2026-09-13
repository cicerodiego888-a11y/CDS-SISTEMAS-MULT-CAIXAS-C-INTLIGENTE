/**
 * Persistência do estado de saúde (RC3.4.6).
 * Usa central_entradas_config — sem SEFAZ.
 *
 * @module motores/central-entradas/health/HealthRepository
 */

const CentralConfigRepository = require('../repositories/CentralConfigRepository');
const { resolverDb, criarDbHelpers } = require('../repositories/dbHelpers');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');

const CHAVE_ESTADO = 'central_health_state';
const LIMITE_SCAN = 250;

class HealthRepository {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._config = deps.configRepository || new CentralConfigRepository();
    this._db = deps.db ?? null;
    this._sql = null;
  }

  /** @private */
  _obterSql() {
    if (!this._sql) {
      this._sql = criarDbHelpers(resolverDb(this._db));
    }
    return this._sql;
  }

  /**
   * Lista documentos ativos com flags leves (sem carregar XML/parse).
   * @returns {Promise<Object[]>}
   */
  async listarDocumentosParaAnalise(limite = LIMITE_SCAN) {
    const sql = this._obterSql();
    await sql.whenReady();
    const terminais = [
      DocumentoFiscalStatus.GRAVADA,
      DocumentoFiscalStatus.DESCARTADA,
      DocumentoFiscalStatus.DUPLICADA
    ];
    const placeholders = terminais.map(() => '?').join(',');
    const rows = await sql.all(
      `SELECT id, chave, numero, serie, fornecedor, cnpj_fornecedor,
              valor_total, nsu, origem, status, status_detalhe, tipo_documento,
              miip_sessao_id, miip_resumo_json, compra_id, processado_em,
              data_emissao, created_at, updated_at,
              CASE WHEN parse_json IS NOT NULL AND length(parse_json) > 10 THEN 1 ELSE 0 END AS tem_parse,
              CASE WHEN miip_resumo_json IS NOT NULL AND length(miip_resumo_json) > 2 THEN 1 ELSE 0 END AS tem_miip,
              CASE WHEN xml IS NOT NULL AND length(xml) > 1500 THEN 1 ELSE 0 END AS xml_completo_provavel,
              length(COALESCE(xml,'')) AS xml_len
       FROM central_entradas_documentos
       WHERE status NOT IN (${placeholders})
          OR status = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [...terminais, DocumentoFiscalStatus.XML_INDISPONIVEL, Math.min(Number(limite) || LIMITE_SCAN, 400)]
    );

    return (rows || []).map((row) => ({
      id: row.id,
      chave: row.chave,
      numero: row.numero,
      serie: row.serie,
      fornecedor: row.fornecedor,
      cnpjFornecedor: row.cnpj_fornecedor,
      valorTotal: row.valor_total,
      nsu: row.nsu,
      origem: row.origem,
      status: row.status,
      statusDetalhe: row.status_detalhe,
      tipoDocumento: row.tipo_documento,
      miipSessaoId: row.miip_sessao_id,
      miipResumoJson: row.miip_resumo_json,
      compraId: row.compra_id,
      processadoEm: row.processado_em,
      dataEmissao: row.data_emissao,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      temParse: Number(row.tem_parse) === 1,
      temMiip: Number(row.tem_miip) === 1,
      xmlCompletoProvavel: Number(row.xml_completo_provavel) === 1
        || ['PROC_NFE', 'NFE'].includes(row.tipo_documento),
      xmlLen: Number(row.xml_len || 0)
    }));
  }

  /**
   * Estatísticas agregadas (somente leitura).
   * @returns {Promise<Object>}
   */
  async obterEstatisticasFluxo() {
    const sql = this._obterSql();
    await sql.whenReady();

    const row = await sql.get(
      `SELECT
         AVG(CASE
           WHEN processado_em IS NOT NULL AND created_at IS NOT NULL
             AND tipo_documento IN ('PROC_NFE','NFE')
           THEN (julianday(processado_em) - julianday(created_at)) * 24 * 60
           ELSE NULL END) AS tempo_medio_ate_xml_min,
         AVG(CASE
           WHEN status = 'GRAVADA' AND compra_id IS NOT NULL AND created_at IS NOT NULL
           THEN (julianday(updated_at) - julianday(created_at)) * 24 * 60
           ELSE NULL END) AS tempo_medio_ate_compra_min,
         AVG(CASE
           WHEN miip_resumo_json IS NOT NULL AND processado_em IS NOT NULL
           THEN (julianday(updated_at) - julianday(processado_em)) * 24 * 60
           ELSE NULL END) AS tempo_medio_miip_min,
         SUM(CASE WHEN origem = 'upload' AND status != 'AGUARDANDO_XML_COMPLETO' THEN 1 ELSE 0 END) AS recuperados_manuais,
         SUM(CASE WHEN origem = 'dfe' AND tipo_documento IN ('PROC_NFE','NFE')
                   AND status != 'AGUARDANDO_XML_COMPLETO' THEN 1 ELSE 0 END) AS recuperados_auto,
         COUNT(*) AS total
       FROM central_entradas_documentos`
    );

    return {
      tempoMedioAteXmlMin: row?.tempo_medio_ate_xml_min != null
        ? Math.round(Number(row.tempo_medio_ate_xml_min))
        : null,
      tempoMedioAteCompraMin: row?.tempo_medio_ate_compra_min != null
        ? Math.round(Number(row.tempo_medio_ate_compra_min))
        : null,
      tempoMedioMiipMin: row?.tempo_medio_miip_min != null
        ? Math.round(Number(row.tempo_medio_miip_min))
        : null,
      recuperadosManualmente: Number(row?.recuperados_manuais || 0),
      recuperadosAutomaticamente: Number(row?.recuperados_auto || 0),
      totalDocumentos: Number(row?.total || 0)
    };
  }

  async carregarEstado() {
    try {
      const reg = await this._config.buscarPorChave(CHAVE_ESTADO);
      const parsed = typeof this._config.parseValor === 'function'
        ? this._config.parseValor(reg)
        : reg?.valor;
      if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return null; }
      }
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async salvarEstado(estado) {
    await this._config.salvar(CHAVE_ESTADO, {
      ...estado,
      atualizadoEm: new Date().toISOString()
    }, 'json');
  }
}

module.exports = HealthRepository;
module.exports.CHAVE_ESTADO = CHAVE_ESTADO;
module.exports.LIMITE_SCAN = LIMITE_SCAN;
