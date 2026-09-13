/**
 * CentralMigracaoLegadoService — Migração RC6.5 de documentos legados (pré-RC6.2).
 *
 * Responsabilidade única: localizar RES_NFE legados incompatíveis e adequá-los a
 * AGUARDANDO_XML_COMPLETO. Não executa Parser, MIIP, Compras nem saveCompra().
 *
 * Atualiza status via repositório (migração de dados) — não altera a máquina de estados.
 *
 * @module motores/central-entradas/services/CentralMigracaoLegadoService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const DocumentoDfeClassifier = require('./DocumentoDfeClassifier');
const { logCentral } = require('../utils/centralLog');

const STATUS_ELEGIVEIS = Object.freeze([
  DocumentoFiscalStatus.SINCRONIZADA,
  // Documentos que já falharam no Parser com o mesmo XML resNFe (auditoria RC6.3)
  DocumentoFiscalStatus.ERRO
]);

const STATUS_NUNCA = Object.freeze([
  DocumentoFiscalStatus.GRAVADA,
  DocumentoFiscalStatus.EM_COMPRA,
  DocumentoFiscalStatus.DESCARTADA,
  DocumentoFiscalStatus.XML_INDISPONIVEL,
  DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
  DocumentoFiscalStatus.EM_PROCESSAMENTO,
  DocumentoFiscalStatus.AGUARDANDO_REVISAO,
  DocumentoFiscalStatus.REVISADA,
  DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
  DocumentoFiscalStatus.DUPLICADA
]);

const TIPOS_NUNCA = Object.freeze([
  DocumentoDfeTipo.NFE,
  DocumentoDfeTipo.PROC_NFE,
  DocumentoDfeTipo.PROC_EVENTO_NFE,
  DocumentoDfeTipo.RES_EVENTO
]);

const DETALHE_STATUS = 'Resumo da NF-e recebido. Aguardando o XML completo para continuar o processamento.';

const DETALHE_HISTORICO = [
  'Migração RC6.5',
  'Documento legado migrado para a arquitetura oficial.',
  'Resumo DF-e identificado.',
  'Aguardando recebimento do XML completo.'
].join('\n');

class CentralMigracaoLegadoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: deps.db ?? null });
    /** @private */
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository({ db: deps.db ?? null });
  }

  /**
   * @param {string|null|undefined} xml
   * @returns {boolean}
   */
  static ehResumoNfeLegado(xml) {
    if (!xml) return false;
    const tipo = DocumentoDfeClassifier.classificar(xml);
    if (tipo === DocumentoDfeTipo.RES_NFE) return true;
    const trim = String(xml).trim();
    return /^<resNFe[\s>]/i.test(trim);
  }

  /**
   * @param {Object} documento
   * @returns {boolean}
   */
  static ehCandidatoMigracao(documento) {
    if (!documento) return false;

    const tipoDoc = documento.tipoDocumento ?? documento.tipo_documento ?? null;
    if (tipoDoc != null && String(tipoDoc).trim() !== '') return false;

    const status = documento.status;
    if (!STATUS_ELEGIVEIS.includes(status)) return false;
    if (STATUS_NUNCA.includes(status)) return false;

    if (TIPOS_NUNCA.includes(DocumentoDfeClassifier.classificar(documento.xml))) {
      return false;
    }

    return CentralMigracaoLegadoService.ehResumoNfeLegado(documento.xml);
  }

  /**
   * Lista candidatos (tipo_documento NULL + status elegível + XML RES_NFE).
   * @returns {Promise<Object[]>}
   */
  async listarCandidatos() {
    const sql = this._documentosRepository._obterSql();
    await sql.whenReady();

    const placeholders = STATUS_ELEGIVEIS.map(() => '?').join(', ');
    const rows = await sql.all(
      `SELECT * FROM ${CentralDocumentosRepository.TABELA}
       WHERE (tipo_documento IS NULL OR tipo_documento = '')
         AND status IN (${placeholders})
       ORDER BY id ASC`,
      [...STATUS_ELEGIVEIS]
    );

    return rows
      .map((row) => this._documentosRepository._mapearRow(row))
      .filter((doc) => CentralMigracaoLegadoService.ehCandidatoMigracao(doc));
  }

  /**
   * Migra um documento legado. Idempotente se já não for candidato.
   * @param {Object} documento
   * @returns {Promise<{ migrado: boolean, documento: Object|null, motivo?: string }>}
   */
  async migrarDocumento(documento) {
    if (!CentralMigracaoLegadoService.ehCandidatoMigracao(documento)) {
      return { migrado: false, documento, motivo: 'nao_candidato' };
    }

    const id = documento.id;
    const statusAnterior = documento.status;
    const xmlOriginal = documento.xml;
    const chaveOriginal = documento.chave;
    const nsuOriginal = documento.nsu;
    const origemOriginal = documento.origem;
    const createdAtOriginal = documento.createdAt ?? documento.created_at;

    await this._documentosRepository.atualizar(id, {
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      statusDetalhe: DETALHE_STATUS
    });

    await this._historicoRepository.inserir({
      documentoId: id,
      statusAnterior,
      statusNovo: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      detalhe: DETALHE_HISTORICO
    });

    const atualizado = await this._documentosRepository.buscarPorId(id);

    // Garantias de preservação
    if (atualizado.xml !== xmlOriginal
      || atualizado.chave !== chaveOriginal
      || atualizado.id !== id
      || String(atualizado.nsu ?? '') !== String(nsuOriginal ?? '')
      || atualizado.origem !== origemOriginal) {
      const erro = new Error(`Migração RC6.5 violou preservação do documento #${id}`);
      erro.statusCode = 500;
      throw erro;
    }

    if (createdAtOriginal && atualizado.createdAt && atualizado.createdAt !== createdAtOriginal) {
      // created_at não deve mudar; se o mapper normalizar formato, só alerta em log
      logCentral('MIGRACAO', {
        mensagem: 'created_at comparado após migração',
        documentoId: id,
        antes: createdAtOriginal,
        depois: atualizado.createdAt
      });
    }

    try {
      const { emitirDocumentoMigrado } = require('../utils/centralEventosEmitter');
      await emitirDocumentoMigrado(atualizado, {
        statusAnterior,
        origem: 'MIGRACAO_RC65'
      });
    } catch { /* ignore */ }

    logCentral('MIGRACAO', {
      mensagem: 'Documento legado migrado RC6.5',
      documentoId: id,
      StatusAnterior: statusAnterior,
      StatusNovo: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
    });

    return { migrado: true, documento: atualizado };
  }

  /**
   * Executa migração em lote. Idempotente.
   * @returns {Promise<{ analisados: number, migrados: number, ignorados: number, erros: number, idsMigrados: number[] }>}
   */
  async executar() {
    const candidatos = await this.listarCandidatos();
    let migrados = 0;
    let ignorados = 0;
    let erros = 0;
    const idsMigrados = [];

    for (const doc of candidatos) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const resultado = await this.migrarDocumento(doc);
        if (resultado.migrado) {
          migrados += 1;
          idsMigrados.push(doc.id);
        } else {
          ignorados += 1;
        }
      } catch (error) {
        erros += 1;
        logCentral('MIGRACAO', {
          mensagem: 'Falha ao migrar documento legado',
          documentoId: doc.id,
          Erro: error.message
        });
      }
    }

    // analisados = candidatos encontrados nesta execução
    // Em 2ª execução candidatos=0 → tudo zero (idempotente)
    return {
      analisados: candidatos.length,
      migrados,
      ignorados,
      erros,
      idsMigrados
    };
  }
}

CentralMigracaoLegadoService.STATUS_ELEGIVEIS = STATUS_ELEGIVEIS;
CentralMigracaoLegadoService.DETALHE_STATUS = DETALHE_STATUS;
CentralMigracaoLegadoService.DETALHE_HISTORICO = DETALHE_HISTORICO;

module.exports = CentralMigracaoLegadoService;
