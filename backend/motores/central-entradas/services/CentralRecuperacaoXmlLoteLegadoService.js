/**
 * CentralRecuperacaoXmlLoteLegadoService — RC3.4.8
 *
 * Recupera XMLs de documentos legados ainda pendentes via fluxo oficial:
 * TransitionService (reabertura) → MIRX → DistDFe → consChNFe → Parser → MIIP → Compra.
 *
 * Não consulta documentos recentes. Não importa XML manualmente.
 * Não altera banco fora do TransitionService / MIRX / Orchestrator.
 *
 * @module motores/central-entradas/services/CentralRecuperacaoXmlLoteLegadoService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralEventosRepository = require('../repositories/CentralEventosRepository');
const DocumentoTransitionService = require('./DocumentoTransitionService');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { logCentral } = require('../utils/centralLog');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');

/** Status documentais elegíveis (sprint: AGUARDANDO_XML / XML_INDISPONIVEL / ESTADO_TERMINAL XML). */
const STATUS_ELEGIVEIS = Object.freeze([
  DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
  DocumentoFiscalStatus.XML_INDISPONIVEL
]);

/** Idade mínima padrão para considerar “legado” (não afeta notas novas do dia). */
const IDADE_MINIMA_HORAS_PADRAO = 24;

/** Limite de documentos por execução. */
const LIMITE_PADRAO = 200;

const STATUS_PARSER = Object.freeze([
  DocumentoFiscalStatus.EM_PROCESSAMENTO,
  DocumentoFiscalStatus.AGUARDANDO_REVISAO,
  DocumentoFiscalStatus.REVISADA,
  DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
  DocumentoFiscalStatus.EM_COMPRA,
  DocumentoFiscalStatus.GRAVADA,
  DocumentoFiscalStatus.ERRO
]);

const STATUS_MIIP = Object.freeze([
  DocumentoFiscalStatus.AGUARDANDO_REVISAO,
  DocumentoFiscalStatus.REVISADA,
  DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
  DocumentoFiscalStatus.EM_COMPRA,
  DocumentoFiscalStatus.GRAVADA
]);

const STATUS_COMPRA = Object.freeze([
  DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
  DocumentoFiscalStatus.EM_COMPRA,
  DocumentoFiscalStatus.GRAVADA
]);

class CentralRecuperacaoXmlLoteLegadoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: deps.db ?? null });
    this._eventosRepository = deps.eventosRepository
      ?? new CentralEventosRepository({ db: deps.db ?? null });
    this._transitionService = deps.transitionService
      ?? new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: deps.historicoRepository
      });
    this._xmlWait = deps.xmlWait || null;
    this._agora = deps.agora || (() => new Date());
  }

  /** @private */
  _obterXmlWait() {
    if (!this._xmlWait) {
      this._xmlWait = require('./CentralXmlWaitScheduler');
    }
    return this._xmlWait;
  }

  /**
   * @param {Object} [opcoes]
   * @param {number} [opcoes.idadeMinimaHoras=24] — docs mais novos são ignorados
   * @param {number} [opcoes.limite=200]
   * @param {boolean} [opcoes.dryRun=false] — só lista/analisa, sem MIRX
   * @param {string} [opcoes.correlationId]
   * @param {number|null} [opcoes.usuarioId]
   * @returns {Promise<Object>}
   */
  async executar(opcoes = {}) {
    const idadeMinimaHoras = Math.max(
      1,
      Number(opcoes.idadeMinimaHoras ?? IDADE_MINIMA_HORAS_PADRAO) || IDADE_MINIMA_HORAS_PADRAO
    );
    const limite = Math.min(
      500,
      Math.max(1, Number(opcoes.limite ?? LIMITE_PADRAO) || LIMITE_PADRAO)
    );
    const dryRun = opcoes.dryRun === true;
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const agora = this._agora();
    const corteMs = agora.getTime() - (idadeMinimaHoras * 60 * 60 * 1000);

    const candidatosBrutos = await this._documentosRepository.listar({
      statusIn: [...STATUS_ELEGIVEIS],
      limite: Math.max(limite * 3, 100),
      ordenarPor: 'created_at',
      ordenarDirecao: 'ASC'
    });

    const candidatos = [];
    const ignoradosRecentes = [];

    for (const doc of candidatosBrutos || []) {
      if (!this._ehCandidatoTipo(doc)) continue;
      const created = this._parseData(doc.createdAt || doc.created_at);
      if (!created || created.getTime() > corteMs) {
        ignoradosRecentes.push(Number(doc.id));
        continue;
      }
      candidatos.push(doc);
      if (candidatos.length >= limite) break;
    }

    const relatorio = {
      sprint: 'RC3.4.8',
      dryRun,
      correlationId,
      idadeMinimaHoras,
      analisados: 0,
      xmlsRecuperados: 0,
      aindaIndisponivel: 0,
      seguiramParser: 0,
      chegaramMiip: 0,
      prontosCompra: 0,
      reabertosTerminal: 0,
      ignoradosRecentes: ignoradosRecentes.length,
      ignoradosPrecondicao: 0,
      erros: 0,
      detalhes: []
    };

    logCentral('RC348', {
      evento: 'LOTE_INICIO',
      correlationId,
      candidatos: candidatos.length,
      ignoradosRecentes: ignoradosRecentes.length,
      idadeMinimaHoras,
      dryRun
    });

    for (const doc of candidatos) {
      relatorio.analisados += 1;
      const detalhe = await this._processarDocumento(doc, {
        dryRun,
        correlationId,
        usuarioId: opcoes.usuarioId ?? null
      });
      relatorio.detalhes.push(detalhe);

      if (detalhe.reaberto) relatorio.reabertosTerminal += 1;
      if (detalhe.ignoradoPrecondicao) relatorio.ignoradosPrecondicao += 1;
      if (detalhe.erro) relatorio.erros += 1;

      if (detalhe.xmlRecuperado) relatorio.xmlsRecuperados += 1;
      if (detalhe.aindaIndisponivel) relatorio.aindaIndisponivel += 1;
      if (detalhe.seguiuParser) relatorio.seguiramParser += 1;
      if (detalhe.chegouMiip) relatorio.chegaramMiip += 1;
      if (detalhe.prontoCompra) relatorio.prontosCompra += 1;
    }

    await this._atualizarSaude(correlationId);

    logCentral('RC348', {
      evento: 'LOTE_FIM',
      correlationId,
      analisados: relatorio.analisados,
      xmlsRecuperados: relatorio.xmlsRecuperados,
      aindaIndisponivel: relatorio.aindaIndisponivel,
      seguiramParser: relatorio.seguiramParser,
      chegaramMiip: relatorio.chegaramMiip,
      prontosCompra: relatorio.prontosCompra
    });

    return relatorio;
  }

  /**
   * Lista candidatos legados sem executar MIRX.
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async listarCandidatos(opcoes = {}) {
    return this.executar({ ...opcoes, dryRun: true });
  }

  /** @private */
  _ehCandidatoTipo(doc) {
    if (!doc) return false;
    if (!STATUS_ELEGIVEIS.includes(doc.status)) return false;
    const tipo = doc.tipoDocumento || doc.tipo_documento;
    if (tipo === DocumentoDfeTipo.RES_NFE) return true;
    // Legados sem tipo classificado, ainda com resumo / aguardando XML.
    if (!tipo && doc.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) return true;
    if (!tipo && doc.status === DocumentoFiscalStatus.XML_INDISPONIVEL) return true;
    return false;
  }

  /** @private */
  _parseData(valor) {
    if (!valor) return null;
    const d = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** @private */
  async _temManifestacaoAceita(documentoId) {
    try {
      if (typeof this._eventosRepository.existePorTipoDocumento === 'function') {
        return this._eventosRepository.existePorTipoDocumento(
          TIPOS_EVENTO.MANIFESTACAO_ACEITA,
          documentoId
        );
      }
      const lista = await this._eventosRepository.listar({
        tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        documentoId,
        limite: 1
      });
      return Boolean(lista?.[0]);
    } catch {
      return false;
    }
  }

  /** @private */
  async _processarDocumento(doc, ctx) {
    const id = Number(doc.id);
    const base = {
      documentoId: id,
      chave: doc.chave || null,
      nsu: doc.nsu || null,
      statusInicial: doc.status,
      statusFinal: doc.status,
      reaberto: false,
      xmlRecuperado: false,
      aindaIndisponivel: false,
      seguiuParser: false,
      chegouMiip: false,
      prontoCompra: false,
      ignoradoPrecondicao: false,
      erro: false,
      motivo: null,
      codigoMirx: null
    };

    if (!doc.chave || String(doc.chave).trim().length < 44) {
      return {
        ...base,
        ignoradoPrecondicao: true,
        aindaIndisponivel: true,
        motivo: 'SEM_CHAVE — documento legado sem chave NF-e válida'
      };
    }

    const temCiencia = await this._temManifestacaoAceita(id);
    if (!temCiencia) {
      return {
        ...base,
        ignoradoPrecondicao: true,
        aindaIndisponivel: true,
        motivo: 'SEM_MANIFESTACAO — Ciência (210210) aceita inexistente; MIRX não consulta SEFAZ'
      };
    }

    if (ctx.dryRun) {
      return {
        ...base,
        aindaIndisponivel: true,
        motivo: 'DRY_RUN — candidato legado elegível (MIRX não executado)'
      };
    }

    try {
      let statusAtual = doc.status;

      if (statusAtual === DocumentoFiscalStatus.XML_INDISPONIVEL) {
        await this._transitionService.transicionar(
          id,
          DocumentoFiscalStatus.XML_INDISPONIVEL,
          DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
          {
            detalhe: [
              'RC3.4.8 — Reabertura oficial para recuperação em lote de XML legado.',
              'Fluxo: MIRX → DistDFe → consChNFe (quando permitido).'
            ].join('\n'),
            usuarioId: ctx.usuarioId,
            origem: ORIGENS.SISTEMA || 'sistema'
          }
        );
        statusAtual = DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO;
        base.reaberto = true;
      }

      const mirx = this._obterXmlWait();
      const resultado = await mirx.solicitarXmlManual(id, {
        correlationId: ctx.correlationId,
        usuarioId: ctx.usuarioId
      });

      base.codigoMirx = resultado?.codigo || null;

      const atualizado = await this._documentosRepository.buscarPorId(id);
      base.statusFinal = atualizado?.status || statusAtual;

      return this._classificarResultado(base, atualizado, resultado);
    } catch (error) {
      logCentral('RC348', {
        evento: 'DOC_ERRO',
        documentoId: id,
        correlationId: ctx.correlationId,
        erro: error.message
      });
      return {
        ...base,
        erro: true,
        aindaIndisponivel: true,
        motivo: error.message || 'ERRO_PROCESSAMENTO'
      };
    }
  }

  /** @private */
  _classificarResultado(base, doc, resultadoMirx) {
    const status = doc?.status || base.statusFinal;
    const out = { ...base, statusFinal: status };

    if (resultadoMirx?.codigo === 'XML_RECUPERADO' || resultadoMirx?.xmlCompleto === true) {
      out.xmlRecuperado = true;
    }

    if (
      status
      && status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      && status !== DocumentoFiscalStatus.XML_INDISPONIVEL
      && [DocumentoDfeTipo.NFE, DocumentoDfeTipo.PROC_NFE].includes(doc?.tipoDocumento)
    ) {
      out.xmlRecuperado = true;
    }

    if (STATUS_PARSER.includes(status) || out.xmlRecuperado) {
      if (STATUS_PARSER.includes(status) || doc?.parseJson || doc?.parse_json) {
        out.seguiuParser = true;
      }
      // XML recuperado → SINCRONIZADA já saiu do aguardo; parser pode ser assíncrono.
      if (out.xmlRecuperado && status === DocumentoFiscalStatus.SINCRONIZADA) {
        out.seguiuParser = true;
      }
    }

    if (
      STATUS_MIIP.includes(status)
      || doc?.miipSessaoId
      || doc?.miip_sessao_id
      || doc?.miipResumoJson
    ) {
      out.chegouMiip = true;
      out.seguiuParser = true;
      out.xmlRecuperado = true;
    }

    if (STATUS_COMPRA.includes(status) || doc?.compraId || doc?.compra_id) {
      out.prontoCompra = true;
      out.chegouMiip = true;
      out.seguiuParser = true;
      out.xmlRecuperado = true;
    }

    if (!out.xmlRecuperado) {
      out.aindaIndisponivel = true;
      out.motivo = out.motivo
        || resultadoMirx?.mensagem
        || resultadoMirx?.codigo
        || 'XML_AINDA_INDISPONIVEL — documento permanece no fluxo oficial de espera';
    } else if (!out.motivo) {
      out.motivo = 'XML_RECUPERADO — fluxo oficial MIRX concluído para este documento';
    }

    return out;
  }

  /** @private */
  async _atualizarSaude(correlationId) {
    try {
      const health = require('../health');
      if (typeof health.forcarScan === 'function') {
        await health.forcarScan({
          forcar: true,
          motivo: 'RC3.4.8',
          correlationId,
          autoRecuperar: true
        });
      }
    } catch {
      /* Health é observabilidade; falha não aborta o lote. */
    }
  }
}

module.exports = CentralRecuperacaoXmlLoteLegadoService;
module.exports.STATUS_ELEGIVEIS = STATUS_ELEGIVEIS;
module.exports.IDADE_MINIMA_HORAS_PADRAO = IDADE_MINIMA_HORAS_PADRAO;
