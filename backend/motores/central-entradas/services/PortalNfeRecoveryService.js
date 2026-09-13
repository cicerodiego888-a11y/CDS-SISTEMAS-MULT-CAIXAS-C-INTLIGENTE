/**
 * PortalNfeRecoveryService — RC3.5.0
 *
 * Orquestra recuperação de XML via Portal Nacional:
 * elegibilidade → validação → CentralImportacaoXmlLegadoService → pipeline oficial.
 *
 * NÃO abre o Portal (Electron). NÃO altera MIRX/Parser/MIIP.
 *
 * @module motores/central-entradas/services/PortalNfeRecoveryService
 */

'use strict';

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const CentralImportacaoXmlLegadoService = require('./CentralImportacaoXmlLegadoService');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { logCentral } = require('../utils/centralLog');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');

/** Inclui AGUARDANDO_XML_COMPLETO no botão Portal (configurável; default false = MIRX prioridade). */
const INCLUIR_AGUARDANDO_XML_PADRAO = false;

const ORIGEM_PORTAL = ORIGENS.PORTAL_NACIONAL || 'portal_nacional';

class PortalNfeRecoveryService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: deps.db ?? null });
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository({ db: deps.db ?? null });
    this._importacao = deps.importacaoService
      ?? new CentralImportacaoXmlLegadoService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository,
        transitionService: deps.transitionService,
        processamentoService: deps.processamentoService,
        xmlWait: deps.xmlWait,
        obterCnpjEmpresa: deps.obterCnpjEmpresa,
        emitirEvento: deps.emitirEvento
      });
    this._emitirEvento = deps.emitirEvento || emitirEvento;
    this._incluirAguardandoXml = deps.incluirAguardandoXml;
  }

  /**
   * Status elegíveis para CTA Portal Nacional.
   * @param {Object} [opcoes]
   * @returns {string[]}
   */
  obterStatusElegiveis(opcoes = {}) {
    const incluirAguardando = opcoes.incluirAguardandoXml != null
      ? opcoes.incluirAguardandoXml === true
      : (this._incluirAguardandoXml != null
        ? this._incluirAguardandoXml === true
        : INCLUIR_AGUARDANDO_XML_PADRAO);

    const lista = [DocumentoFiscalStatus.XML_INDISPONIVEL];
    // ERRO_RECUPERACAO (sprint) mapeado ao status oficial ERRO
    lista.push(DocumentoFiscalStatus.ERRO);
    if (incluirAguardando) {
      lista.push(DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    }
    return lista;
  }

  /**
   * @param {Object} doc
   * @param {Object} [opcoes]
   * @returns {boolean}
   */
  ehElegivel(doc, opcoes = {}) {
    if (!doc?.id) return false;
    const status = doc.status;
    if (!this.obterStatusElegiveis(opcoes).includes(status)) return false;
    // Documentos saudáveis com PROC completo nunca
    const tipo = doc.tipoDocumento || doc.tipo_documento;
    if (
      status !== DocumentoFiscalStatus.XML_INDISPONIVEL
      && status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      && status !== DocumentoFiscalStatus.ERRO
      && (tipo === 'PROC_NFE' || tipo === 'NFE')
    ) {
      return false;
    }
    const chave = String(doc.chave || '').replace(/\D/g, '');
    return chave.length === 44;
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   */
  async avaliarDocumento(documentoId, opcoes = {}) {
    const doc = await this._documentosRepository.buscarPorId(documentoId);
    if (!doc) {
      return {
        elegivel: false,
        codigo: 'DOCUMENTO_NAO_ENCONTRADO',
        mensagem: 'Documento não encontrado'
      };
    }
    const elegivel = this.ehElegivel(doc, opcoes);
    return {
      elegivel,
      documentoId: Number(doc.id),
      chave: doc.chave || null,
      status: doc.status,
      numero: doc.numero || null,
      serie: doc.serie || null,
      dataEmissao: doc.dataEmissao || null,
      fornecedor: doc.fornecedor || null,
      codigo: elegivel ? 'ELEGIVEL' : 'NAO_ELEGIVEL',
      mensagem: elegivel
        ? 'Documento elegível para recuperação pelo Portal Nacional'
        : 'Documento não elegível (status saudável ou sem chave)'
    };
  }

  /** @private */
  async _emitir(tipo, payload) {
    try {
      await this._emitirEvento({
        tipo,
        origem: ORIGEM_PORTAL,
        ...payload
      });
    } catch { /* ignore */ }
  }

  /**
   * RC3.6.0 — Registra abertura da Central de Recuperação CDS (antes do Portal).
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   */
  async registrarCentralRecuperacaoAberta(documentoId, opcoes = {}) {
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const doc = await this._documentosRepository.buscarPorId(documentoId);
    const status = doc?.status || DocumentoFiscalStatus.XML_INDISPONIVEL;
    const chave = opcoes.chave || doc?.chave || null;

    await this._emitir(TIPOS_EVENTO.CENTRAL_RECUPERACAO_ABERTA || 'CENTRAL_RECUPERACAO_ABERTA', {
      descricao: 'Central de Recuperação CDS aberta',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId: opcoes.usuarioId ?? null,
      detalhe: { correlationId, chave, status }
    });

    try {
      await this._historicoRepository.inserir({
        documentoId: Number(documentoId),
        statusAnterior: status,
        statusNovo: status,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: [
          'CENTRAL_RECUPERACAO_ABERTA — Central de Recuperação CDS',
          `Chave: ${chave || '—'}`,
          `Usuário: ${opcoes.usuarioNome || opcoes.usuarioId || 'sistema'}`,
          `Correlation: ${correlationId}`
        ].join('\n')
      });
    } catch { /* ignore */ }

    return { sucesso: true, correlationId, chave, status };
  }

  /**
   * RC3.6.0 — Usuário confirmou consulta no Portal (antes de abrir BrowserWindow).
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   */
  async registrarConsultaPortalIniciada(documentoId, opcoes = {}) {
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const doc = await this._documentosRepository.buscarPorId(documentoId);
    const status = doc?.status || DocumentoFiscalStatus.XML_INDISPONIVEL;
    const chave = opcoes.chave || doc?.chave || null;

    await this._emitir(TIPOS_EVENTO.PORTAL_CONSULTA_INICIADA || 'PORTAL_CONSULTA_INICIADA', {
      descricao: 'Consulta no Portal Nacional iniciada pela Central de Recuperação CDS',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId: opcoes.usuarioId ?? null,
      detalhe: { correlationId, chave }
    });

    await this._emitir(TIPOS_EVENTO.RECUPERACAO_INICIADA || 'RECUPERACAO_INICIADA', {
      descricao: 'Recuperação iniciada pelo Assistente CDS',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId: opcoes.usuarioId ?? null,
      detalhe: { correlationId, chave }
    });

    try {
      await this._historicoRepository.inserir({
        documentoId: Number(documentoId),
        statusAnterior: status,
        statusNovo: status,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: [
          'PORTAL_CONSULTA_INICIADA',
          `Chave: ${chave || '—'}`,
          `Usuário: ${opcoes.usuarioNome || opcoes.usuarioId || 'sistema'}`,
          `Correlation: ${correlationId}`
        ].join('\n')
      });
    } catch { /* ignore */ }

    return { sucesso: true, correlationId };
  }

  /**
   * RC3.6.0 — Download detectado pelo will-download do Electron.
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   */
  async registrarDownloadDetectado(documentoId, opcoes = {}) {
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const doc = await this._documentosRepository.buscarPorId(documentoId);
    const status = doc?.status || DocumentoFiscalStatus.XML_INDISPONIVEL;

    await this._emitir(TIPOS_EVENTO.DOWNLOAD_DETECTADO || 'DOWNLOAD_DETECTADO', {
      descricao: 'Download de XML detectado no Portal Nacional',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId: opcoes.usuarioId ?? null,
      detalhe: {
        correlationId,
        nomeArquivo: opcoes.nomeArquivo || null,
        chave: opcoes.chave || doc?.chave || null
      }
    });

    try {
      await this._historicoRepository.inserir({
        documentoId: Number(documentoId),
        statusAnterior: status,
        statusNovo: status,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: [
          'DOWNLOAD_DETECTADO',
          opcoes.nomeArquivo ? `Arquivo: ${opcoes.nomeArquivo}` : null,
          `Correlation: ${correlationId}`
        ].filter(Boolean).join('\n')
      });
    } catch { /* ignore */ }

    return { sucesso: true, correlationId };
  }

  /**
   * Registra abertura do Portal (chamado pelo frontend após IPC).
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   */
  async registrarPortalAberto(documentoId, opcoes = {}) {
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const doc = await this._documentosRepository.buscarPorId(documentoId);
    const status = doc?.status || DocumentoFiscalStatus.XML_INDISPONIVEL;
    const chave = opcoes.chave || doc?.chave || null;
    const metodoChave = opcoes.metodoChave || opcoes.metodo_chave || null;

    await this._emitir(TIPOS_EVENTO.PORTAL_ABERTO || 'PORTAL_ABERTO', {
      descricao: 'Portal Nacional da NF-e aberto para recuperação de XML',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId: opcoes.usuarioId ?? null,
      detalhe: {
        correlationId,
        chave,
        metodoChave
      }
    });

    if (chave) {
      const tipoChave = metodoChave === 'preenchida'
        ? TIPOS_EVENTO.CHAVE_ENVIADA
        : (metodoChave === 'clipboard' ? TIPOS_EVENTO.CHAVE_COPIADA_AUTOMATICAMENTE : null);
      if (tipoChave) {
        await this._emitir(tipoChave, {
          descricao: tipoChave === TIPOS_EVENTO.CHAVE_ENVIADA
            ? 'Chave da NF-e preenchida automaticamente no Portal Nacional'
            : 'Chave da NF-e copiada automaticamente — use CTRL+V no Portal',
          sucesso: true,
          documentoId: Number(documentoId),
          usuarioId: opcoes.usuarioId ?? null,
          detalhe: { correlationId, chave, metodoChave }
        });
      }
    }

    try {
      await this._historicoRepository.inserir({
        documentoId: Number(documentoId),
        statusAnterior: status,
        statusNovo: status,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: [
          'PORTAL_ABERTO — Portal Nacional da NF-e',
          `Chave: ${chave || '—'}`,
          metodoChave ? `Método chave: ${metodoChave}` : null,
          `Usuário: ${opcoes.usuarioNome || opcoes.usuarioId || 'sistema'}`,
          `Correlation: ${correlationId}`
        ].filter(Boolean).join('\n')
      });
    } catch { /* ignore */ }
    return { sucesso: true, correlationId, metodoChave };
  }

  /**
   * Importa XML baixado do Portal via pipeline oficial RC3.4.9.
   *
   * @param {number|string} documentoId
   * @param {Object} arquivo — { originalname|nome, buffer|xml }
   * @param {Object} [opcoes]
   */
  async importarXmlBaixado(documentoId, arquivo, opcoes = {}) {
    const inicio = Date.now();
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const usuarioId = opcoes.usuarioId ?? null;

    const avaliacao = await this.avaliarDocumento(documentoId, opcoes);
    if (!avaliacao.elegivel) {
      await this._emitir(TIPOS_EVENTO.XML_REJEITADO, {
        descricao: 'Recuperação Portal rejeitada — documento não elegível',
        sucesso: false,
        documentoId: Number(documentoId),
        usuarioId,
        resultado: avaliacao.codigo,
        detalhe: { correlationId, mensagem: avaliacao.mensagem }
      });
      return {
        sucesso: false,
        codigo: avaliacao.codigo,
        mensagem: avaliacao.mensagem,
        correlationId
      };
    }

    await this._emitir(TIPOS_EVENTO.PIPELINE_INICIADO || 'PIPELINE_INICIADO', {
      descricao: 'Pipeline oficial iniciado (Portal Nacional)',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId,
      detalhe: { correlationId, origem: ORIGEM_PORTAL }
    });

    const nome = arquivo?.originalname || arquivo?.nome || arquivo?.nomeArquivo || 'portal-nfe.xml';
    const payload = arquivo?.buffer
      ? { originalname: nome, buffer: arquivo.buffer }
      : { nomeArquivo: nome, xml: arquivo?.xml || arquivo?.conteudo };

    await this._emitir(TIPOS_EVENTO.IMPORTACAO_INICIADA || 'IMPORTACAO_INICIADA', {
      descricao: 'Importação de XML iniciada (Assistente de Recuperação)',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId,
      detalhe: { correlationId, nomeArquivo: nome, origem: ORIGEM_PORTAL }
    });

    const relatorio = await this._importacao.executar([payload], {
      dryRun: false,
      processarPipeline: opcoes.processarPipeline !== false,
      recusarCancelados: opcoes.recusarCancelados !== false,
      usuarioId,
      usuarioNome: opcoes.usuarioNome || null,
      correlationId
    });

    const detalhe = Array.isArray(relatorio.detalhes) ? relatorio.detalhes[0] : null;
    const importado = detalhe?.codigo === 'IMPORTADO' || detalhe?.documentoAlterado === true;

    // Garante match do documento alvo (chave)
    if (importado && detalhe?.documentoId && Number(detalhe.documentoId) !== Number(documentoId)) {
      logCentral('RC350', {
        evento: 'CHAVE_OUTRO_DOCUMENTO',
        esperado: documentoId,
        obtido: detalhe.documentoId,
        correlationId
      });
    }

    if (!importado) {
      await this._emitir(TIPOS_EVENTO.XML_REJEITADO, {
        descricao: `XML do Portal rejeitado: ${detalhe?.mensagem || 'falha'}`,
        sucesso: false,
        documentoId: Number(documentoId),
        usuarioId,
        resultado: detalhe?.codigo || 'XML_REJEITADO',
        detalhe: { correlationId, item: detalhe }
      });
      return {
        sucesso: false,
        codigo: detalhe?.codigo || 'XML_REJEITADO',
        mensagem: detalhe?.mensagem || 'XML rejeitado — não importado',
        correlationId,
        relatorio,
        tempoMs: Date.now() - inicio
      };
    }

    await this._emitir(TIPOS_EVENTO.XML_VALIDADO, {
      descricao: 'XML validado com sucesso (Portal Nacional)',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId,
      detalhe: { correlationId, hash: detalhe.hash || null }
    });

    if (detalhe.parserExecutado) {
      await this._emitir(TIPOS_EVENTO.PARSER_INICIADO, {
        descricao: 'Parser executado na recuperação',
        sucesso: true,
        documentoId: Number(documentoId),
        usuarioId,
        detalhe: { correlationId }
      });
    }

    if (detalhe.miipExecutado) {
      await this._emitir(TIPOS_EVENTO.MIIP_INICIADO, {
        descricao: 'MIIP executado na recuperação',
        sucesso: true,
        documentoId: Number(documentoId),
        usuarioId,
        detalhe: { correlationId }
      });
    }

    if (detalhe.compraCriada || relatorio.comprasCriadas) {
      await this._emitir(TIPOS_EVENTO.COMPRA_CRIADA, {
        descricao: 'Compra criada na recuperação pelo Portal',
        sucesso: true,
        documentoId: Number(documentoId),
        usuarioId,
        detalhe: { correlationId, statusFinal: detalhe.statusFinal || null }
      });
    }

    await this._emitir(TIPOS_EVENTO.DOCUMENTO_RECUPERADO_PORTAL || 'DOCUMENTO_RECUPERADO_PORTAL', {
      descricao: 'Documento recuperado pelo Portal Nacional da NF-e',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId,
      resultado: 'DOCUMENTO_RECUPERADO_PORTAL',
      detalhe: {
        correlationId,
        hash: detalhe.hash || null,
        statusFinal: detalhe.statusFinal || null,
        parserExecutado: detalhe.parserExecutado,
        miipExecutado: detalhe.miipExecutado
      }
    });

    await this._emitir(TIPOS_EVENTO.DOCUMENTO_RECUPERADO || 'DOCUMENTO_RECUPERADO', {
      descricao: 'Documento recuperado com sucesso (Central de Recuperação CDS)',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId,
      resultado: 'DOCUMENTO_RECUPERADO',
      detalhe: {
        correlationId,
        hash: detalhe.hash || null,
        statusFinal: detalhe.statusFinal || null
      }
    });

    await this._emitir(TIPOS_EVENTO.RECUPERACAO_FINALIZADA || 'RECUPERACAO_FINALIZADA', {
      descricao: 'Recuperação finalizada com sucesso pelo Assistente CDS',
      sucesso: true,
      documentoId: Number(documentoId),
      usuarioId,
      resultado: 'RECUPERACAO_FINALIZADA',
      detalhe: {
        correlationId,
        hash: detalhe.hash || null,
        statusFinal: detalhe.statusFinal || null,
        tempoMs: Date.now() - inicio
      }
    });

    try {
      await this._historicoRepository.inserir({
        documentoId: Number(documentoId),
        statusAnterior: avaliacao.status,
        statusNovo: detalhe.statusFinal || null,
        usuarioId,
        detalhe: [
          'DOCUMENTO_RECUPERADO_PORTAL',
          `Arquivo: ${nome}`,
          `Hash: ${detalhe.hash || '—'}`,
          `Status final: ${detalhe.statusFinal || '—'}`,
          'Origem: PORTAL NACIONAL',
          `Correlation: ${correlationId}`
        ].join('\n')
      });
    } catch { /* ignore */ }

    logCentral('RC350', {
      evento: 'RECUPERADO',
      documentoId,
      correlationId,
      statusFinal: detalhe.statusFinal
    });

    return {
      sucesso: true,
      codigo: 'DOCUMENTO_RECUPERADO_PORTAL',
      mensagem: 'Documento recuperado com sucesso pelo Portal Nacional',
      correlationId,
      documentoId: Number(documentoId),
      statusFinal: detalhe.statusFinal || null,
      parserExecutado: Boolean(detalhe.parserExecutado),
      miipExecutado: Boolean(detalhe.miipExecutado),
      relatorio,
      tempoMs: Date.now() - inicio
    };
  }
}

module.exports = PortalNfeRecoveryService;
module.exports.INCLUIR_AGUARDANDO_XML_PADRAO = INCLUIR_AGUARDANDO_XML_PADRAO;
module.exports.ORIGEM_PORTAL = ORIGEM_PORTAL;
