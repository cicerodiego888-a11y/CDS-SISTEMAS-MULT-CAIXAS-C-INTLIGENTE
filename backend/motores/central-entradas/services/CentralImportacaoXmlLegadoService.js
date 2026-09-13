/**
 * CentralImportacaoXmlLegadoService — RC3.4.9
 *
 * Módulo oficial de Importação de XML Legado (Portal Nacional da NF-e).
 * Complementa a Central quando o XML não pode mais ser obtido pela SEFAZ (ex.: 596).
 * NÃO substitui o MIRX. NÃO cria documento novo. NÃO cria pipeline paralelo.
 *
 * Fluxo:
 *   validar nfeProc → localizar por chave → XML_IMPORTADO_MANUALMENTE
 *   → repositório oficial (atualizarComXmlCompleto) → SINCRONIZADA
 *   → CentralProcessamentoService (Parser → MIIP) → Health / Timeline
 *
 * @module motores/central-entradas/services/CentralImportacaoXmlLegadoService
 */

const crypto = require('crypto');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const DocumentoDfeClassifier = require('./DocumentoDfeClassifier');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const DocumentoTransitionService = require('./DocumentoTransitionService');
const CentralDocumentoAtualizacaoService = require('./CentralDocumentoAtualizacaoService');
const CentralProcessamentoService = require('./CentralProcessamentoService');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { logCentral } = require('../utils/centralLog');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');
const {
  extrairMetadadosNota,
  detectarNfCancelada
} = require('../../../services/fiscal/dfeXmlMetadados');
const { validarAssinaturaEstrutura } = require('../../../services/fiscal/validarXmlFiscal');

const ORIGEM_IMPORTACAO = ORIGENS.IMPORTACAO_MANUAL;
const EXTENSAO_XML = /\.xml$/i;

/** Status elegíveis para receber XML legado (não saudáveis / sem nfeProc). */
const STATUS_ELEGIVEIS = Object.freeze([
  DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
  DocumentoFiscalStatus.XML_INDISPONIVEL
]);

const STATUS_SAUDAVEIS = Object.freeze([
  DocumentoFiscalStatus.SINCRONIZADA,
  DocumentoFiscalStatus.EM_PROCESSAMENTO,
  DocumentoFiscalStatus.AGUARDANDO_REVISAO,
  DocumentoFiscalStatus.REVISADA,
  DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
  DocumentoFiscalStatus.EM_COMPRA,
  DocumentoFiscalStatus.GRAVADA
]);

function extrairTag(xml, tag) {
  return String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'i'))?.[1] || '';
}

function extrairBloco(xml, tag) {
  return String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '';
}

function hashXml(xml) {
  return crypto.createHash('sha256').update(String(xml || ''), 'utf8').digest('hex');
}

class CentralImportacaoXmlLegadoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: deps.db ?? null });
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository({ db: deps.db ?? null });
    this._transitionService = deps.transitionService
      ?? new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository,
        historicoService: deps.historicoService
      });
    this._atualizacaoService = deps.atualizacaoService
      ?? new CentralDocumentoAtualizacaoService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository,
        transitionService: this._transitionService
      });
    this._processamento = deps.processamentoService
      ?? new CentralProcessamentoService({
        documentosRepository: this._documentosRepository,
        transitionService: this._transitionService
      });
    this._xmlWait = deps.xmlWait || null;
    this._obterCnpjEmpresa = deps.obterCnpjEmpresa || null;
    this._emitirEvento = deps.emitirEvento || emitirEvento;
  }

  /** @private */
  _obterXmlWait() {
    if (!this._xmlWait) {
      this._xmlWait = require('./CentralXmlWaitScheduler');
    }
    return this._xmlWait;
  }

  /**
   * Processa lote de XMLs legados (Portal Nacional).
   *
   * @param {Object[]} arquivos — { originalname|nome, buffer } ou { nomeArquivo, xml }
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.dryRun=false]
   * @param {boolean} [opcoes.recusarCancelados=true]
   * @param {boolean} [opcoes.processarPipeline=true] — Parser/MIIP após salvar
   * @param {number|null} [opcoes.usuarioId]
   * @param {string} [opcoes.correlationId]
   * @param {string} [opcoes.usuarioNome]
   * @returns {Promise<Object>}
   */
  async executar(arquivos = [], opcoes = {}) {
    const inicio = Date.now();
    const dryRun = opcoes.dryRun === true;
    const recusarCancelados = opcoes.recusarCancelados !== false;
    const processarPipeline = opcoes.processarPipeline !== false;
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const usuarioId = opcoes.usuarioId ?? null;
    const lista = Array.isArray(arquivos) ? arquivos : [];

    const cnpjEmpresa = await this._resolverCnpjEmpresa();

    const relatorio = {
      sprint: 'RC3.4.9',
      dryRun,
      correlationId,
      xmlsEnviados: lista.length,
      xmlsValidos: 0,
      xmlsRejeitados: 0,
      documentosEncontrados: 0,
      documentosNaoEncontrados: 0,
      documentosAlterados: 0,
      parserExecutado: 0,
      miipExecutado: 0,
      comprasCriadas: 0,
      xmlsDuplicadosLote: 0,
      xmlsJaExistentes: 0,
      tempoTotalMs: 0,
      detalhes: []
    };

    logCentral('RC349', {
      evento: 'LOTE_INICIO',
      correlationId,
      enviados: lista.length,
      dryRun
    });

    const chavesNoLote = new Set();

    for (const arquivo of lista) {
      // eslint-disable-next-line no-await-in-loop
      const detalhe = await this._processarArquivo(arquivo, {
        dryRun,
        recusarCancelados,
        processarPipeline,
        correlationId,
        usuarioId,
        usuarioNome: opcoes.usuarioNome || null,
        cnpjEmpresa,
        chavesNoLote
      });

      relatorio.detalhes.push(detalhe);

      if (detalhe.valido) relatorio.xmlsValidos += 1;
      else relatorio.xmlsRejeitados += 1;

      if (detalhe.documentoEncontrado) relatorio.documentosEncontrados += 1;
      if (detalhe.documentoNaoEncontrado) relatorio.documentosNaoEncontrados += 1;
      if (detalhe.documentoAlterado) relatorio.documentosAlterados += 1;
      if (detalhe.parserExecutado) relatorio.parserExecutado += 1;
      if (detalhe.miipExecutado) relatorio.miipExecutado += 1;
      if (detalhe.compraCriada) relatorio.comprasCriadas += 1;
      if (detalhe.codigo === 'XML_DUPLICADO_LOTE') relatorio.xmlsDuplicadosLote += 1;
      if (detalhe.codigo === 'XML_JA_EXISTENTE' || detalhe.codigo === 'DOCUMENTO_SAUDAVEL') {
        relatorio.xmlsJaExistentes += 1;
      }

      if (detalhe.chave) chavesNoLote.add(detalhe.chave);
    }

    if (!dryRun && relatorio.documentosAlterados > 0) {
      await this._atualizarSaude(correlationId);
    }

    relatorio.tempoTotalMs = Date.now() - inicio;

    logCentral('RC349', {
      evento: 'LOTE_FIM',
      correlationId,
      ...relatorio,
      detalhes: undefined
    });

    return relatorio;
  }

  /**
   * Somente valida + localiza (sem persistir / sem pipeline).
   * @param {Object[]} arquivos
   * @param {Object} [opcoes]
   */
  async analisar(arquivos = [], opcoes = {}) {
    return this.executar(arquivos, { ...opcoes, dryRun: true, processarPipeline: false });
  }

  /** @private */
  async _resolverCnpjEmpresa() {
    try {
      if (typeof this._obterCnpjEmpresa === 'function') {
        const cnpj = await this._obterCnpjEmpresa();
        return String(cnpj || '').replace(/\D/g, '');
      }
      const CentralConfiguracaoService = require('./CentralConfiguracaoService');
      const cfg = new CentralConfiguracaoService();
      let cnpj = '';
      if (typeof cfg.obterContextoOperacional === 'function') {
        const ctx = await cfg.obterContextoOperacional();
        cnpj = ctx?.contexto?.cnpj || ctx?.cnpj || ctx?.fiscal?.cnpj || '';
      }
      if (!cnpj && typeof cfg.obterPainelCompleto === 'function') {
        const painel = await cfg.obterPainelCompleto();
        cnpj = painel?.certificado?.cnpj
          || painel?.fiscal?.cnpj
          || painel?.ambiente?.cnpj
          || '';
      }
      return String(cnpj).replace(/\D/g, '');
    } catch {
      return '';
    }
  }

  /** @private */
  _obterNome(arquivo) {
    return String(arquivo?.originalname || arquivo?.nome || arquivo?.nomeArquivo || 'documento.xml');
  }

  /** @private */
  _obterXml(arquivo) {
    if (arquivo?.xml != null) return String(arquivo.xml);
    if (arquivo?.buffer) return arquivo.buffer.toString('utf8');
    if (arquivo?.conteudo != null) return String(arquivo.conteudo);
    return null;
  }

  /** @private */
  _extrairParticipantes(xml) {
    const emit = extrairBloco(xml, 'emit');
    const dest = extrairBloco(xml, 'dest');
    return {
      emitente: extrairTag(emit, 'xNome') || '',
      cnpjEmitente: (extrairTag(emit, 'CNPJ') || '').replace(/\D/g, ''),
      destinatario: extrairTag(dest, 'xNome') || '',
      cnpjDestinatario: (extrairTag(dest, 'CNPJ') || extrairTag(dest, 'CPF') || '').replace(/\D/g, ''),
      protocolo: extrairTag(xml, 'nProt') || '',
      cStat: extrairTag(xml, 'cStat') || ''
    };
  }

  /**
   * Valida nfeProc autorizado (assinatura / chave / protocolo / CNPJ).
   * @private
   */
  _validarXml(xml, nome, opcoes = {}) {
    const base = {
      nomeArquivo: nome,
      chave: null,
      emitente: null,
      destinatario: null,
      cnpjEmitente: null,
      cnpjDestinatario: null,
      protocolo: null,
      hash: null,
      tipoDfe: null
    };

    if (!EXTENSAO_XML.test(nome) && !String(nome).toLowerCase().endsWith('.xml')) {
      // aceita nome sem extensão se conteúdo for XML; PDF/DANFE por extensão
      if (/\.(pdf|png|jpg|jpeg|html?)$/i.test(nome)) {
        return { ...base, valido: false, codigo: 'TIPO_RECUSADO', mensagem: 'Apenas XML nfeProc é aceito (PDF/DANFE recusado)' };
      }
    }

    if (!xml || !String(xml).trim().startsWith('<')) {
      return { ...base, valido: false, codigo: 'XML_INVALIDO', mensagem: 'XML inválido ou vazio' };
    }

    if (/<!DOCTYPE\s+html/i.test(xml) || /<html[\s>]/i.test(xml)) {
      return { ...base, valido: false, codigo: 'TIPO_RECUSADO', mensagem: 'DANFE/HTML recusado — aceite apenas nfeProc' };
    }

    const tipoDfe = DocumentoDfeClassifier.classificar(xml);
    base.tipoDfe = tipoDfe;

    if (tipoDfe === DocumentoDfeTipo.PROC_EVENTO_NFE || tipoDfe === DocumentoDfeTipo.RES_EVENTO) {
      return { ...base, valido: false, codigo: 'TIPO_RECUSADO', mensagem: 'procEvento recusado — aceite apenas nfeProc autorizado' };
    }
    if (tipoDfe === DocumentoDfeTipo.RES_NFE) {
      return { ...base, valido: false, codigo: 'TIPO_RECUSADO', mensagem: 'resNFe recusado — aceite apenas nfeProc autorizado' };
    }
    if (tipoDfe !== DocumentoDfeTipo.PROC_NFE) {
      return {
        ...base,
        valido: false,
        codigo: 'TIPO_RECUSADO',
        mensagem: 'Aceite somente XML nfeProc autorizado (Portal Nacional)'
      };
    }

    if (opcoes.recusarCancelados !== false && detectarNfCancelada(xml)) {
      return { ...base, valido: false, codigo: 'NF_CANCELADA', mensagem: 'XML cancelado/inutilizado (configurável)' };
    }

    const participantes = this._extrairParticipantes(xml);
    base.emitente = participantes.emitente;
    base.destinatario = participantes.destinatario;
    base.cnpjEmitente = participantes.cnpjEmitente;
    base.cnpjDestinatario = participantes.cnpjDestinatario;
    base.protocolo = participantes.protocolo;

    const metadados = extrairMetadadosNota(xml);
    base.chave = metadados.chave || null;
    base.hash = hashXml(xml);

    if (!base.chave || String(base.chave).length !== 44) {
      return { ...base, valido: false, codigo: 'CHAVE_INVALIDA', mensagem: 'Chave de acesso inválida ou ausente' };
    }

    if (!base.protocolo || String(base.protocolo).length < 10) {
      return { ...base, valido: false, codigo: 'PROTOCOLO_AUSENTE', mensagem: 'Protocolo de autorização (nProt) ausente' };
    }

    // cStat 100 = autorizado; 150 = autorizado fora de prazo — ambos nfeProc válidos
    if (participantes.cStat && !['100', '150'].includes(String(participantes.cStat))) {
      return {
        ...base,
        valido: false,
        codigo: 'NAO_AUTORIZADO',
        mensagem: `nfeProc não autorizado (cStat ${participantes.cStat})`
      };
    }

    try {
      validarAssinaturaEstrutura(xml);
    } catch (error) {
      return {
        ...base,
        valido: false,
        codigo: 'ASSINATURA_INVALIDA',
        mensagem: error.message || 'Assinatura digital inválida ou incompleta'
      };
    }

    if (!base.cnpjEmitente || base.cnpjEmitente.length !== 14) {
      return { ...base, valido: false, codigo: 'CNPJ_EMITENTE', mensagem: 'CNPJ do emitente inválido ou ausente' };
    }

    if (!base.cnpjDestinatario || (base.cnpjDestinatario.length !== 14 && base.cnpjDestinatario.length !== 11)) {
      return { ...base, valido: false, codigo: 'CNPJ_DESTINATARIO', mensagem: 'CNPJ/CPF do destinatário inválido ou ausente' };
    }

    const cnpjEmpresa = String(opcoes.cnpjEmpresa || '').replace(/\D/g, '');
    if (cnpjEmpresa && cnpjEmpresa.length === 14 && base.cnpjDestinatario.length === 14) {
      if (base.cnpjDestinatario !== cnpjEmpresa) {
        return {
          ...base,
          valido: false,
          codigo: 'CNPJ_DESTINATARIO_DIVERGENTE',
          mensagem: 'CNPJ do destinatário diverge do CNPJ da empresa'
        };
      }
    }

    return {
      ...base,
      valido: true,
      codigo: 'XML_VALIDADO',
      mensagem: 'XML nfeProc válido',
      metadados
    };
  }

  /** @private */
  async _emitir(tipo, payload) {
    try {
      await this._emitirEvento({
        tipo,
        origem: ORIGEM_IMPORTACAO,
        ...payload
      });
    } catch { /* ignore */ }
  }

  /** @private */
  async _processarArquivo(arquivo, ctx) {
    const nome = this._obterNome(arquivo);
    const xml = this._obterXml(arquivo);
    const agora = new Date();

    const validacao = this._validarXml(xml, nome, {
      recusarCancelados: ctx.recusarCancelados,
      cnpjEmpresa: ctx.cnpjEmpresa
    });

    const base = {
      nomeArquivo: nome,
      chave: validacao.chave,
      emitente: validacao.emitente,
      destinatario: validacao.destinatario,
      protocolo: validacao.protocolo,
      hash: validacao.hash,
      valido: false,
      documentoEncontrado: false,
      documentoNaoEncontrado: false,
      documentoAlterado: false,
      documentoId: null,
      statusInicial: null,
      statusFinal: null,
      parserExecutado: false,
      miipExecutado: false,
      compraCriada: false,
      reaberto: false,
      codigo: validacao.codigo,
      mensagem: validacao.mensagem,
      situacao: validacao.valido ? 'Válido' : 'Rejeitado'
    };

    if (!validacao.valido) {
      await this._emitir(TIPOS_EVENTO.XML_REJEITADO, {
        descricao: `XML rejeitado: ${nome}`,
        sucesso: false,
        resultado: validacao.codigo,
        usuarioId: ctx.usuarioId,
        detalhe: {
          nomeArquivo: nome,
          chave: validacao.chave,
          codigo: validacao.codigo,
          mensagem: validacao.mensagem,
          correlationId: ctx.correlationId
        }
      });
      return base;
    }

    await this._emitir(TIPOS_EVENTO.XML_VALIDADO, {
      descricao: `XML validado: ${nome}`,
      sucesso: true,
      resultado: 'XML_VALIDADO',
      usuarioId: ctx.usuarioId,
      detalhe: {
        nomeArquivo: nome,
        chave: validacao.chave,
        hash: validacao.hash,
        correlationId: ctx.correlationId
      }
    });

    base.valido = true;

    if (ctx.chavesNoLote?.has(validacao.chave)) {
      return {
        ...base,
        valido: false,
        codigo: 'XML_DUPLICADO_LOTE',
        mensagem: 'Chave duplicada neste lote de importação',
        situacao: 'Duplicado no lote'
      };
    }

    const documento = await this._documentosRepository.buscarPorChave(validacao.chave);
    if (!documento) {
      await this._emitir(TIPOS_EVENTO.XML_REJEITADO, {
        descricao: `Documento não encontrado na Central: ${validacao.chave}`,
        sucesso: false,
        resultado: 'DOCUMENTO_NAO_ENCONTRADO',
        usuarioId: ctx.usuarioId,
        detalhe: { chave: validacao.chave, nomeArquivo: nome, correlationId: ctx.correlationId }
      });
      return {
        ...base,
        valido: false,
        documentoNaoEncontrado: true,
        codigo: 'DOCUMENTO_NAO_ENCONTRADO',
        mensagem: 'Nenhum documento correspondente na Central (não cria documento novo)',
        situacao: 'Documento não encontrado'
      };
    }

    base.documentoEncontrado = true;
    base.documentoId = Number(documento.id);
    base.statusInicial = documento.status;

    if (STATUS_SAUDAVEIS.includes(documento.status)) {
      const tipo = documento.tipoDocumento || documento.tipo_documento;
      const temXmlCompleto = tipo === DocumentoDfeTipo.PROC_NFE || tipo === DocumentoDfeTipo.NFE;
      if (temXmlCompleto || documento.status === DocumentoFiscalStatus.GRAVADA) {
        return {
          ...base,
          valido: false,
          codigo: 'DOCUMENTO_SAUDAVEL',
          mensagem: 'Documento saudável — XML existente não será substituído',
          situacao: 'Já existente / saudável',
          statusFinal: documento.status
        };
      }
    }

    if (documento.status === DocumentoFiscalStatus.DUPLICADA
      || documento.status === DocumentoFiscalStatus.DESCARTADA) {
      return {
        ...base,
        valido: false,
        codigo: 'DOCUMENTO_TERMINAL',
        mensagem: `Documento em status terminal ${documento.status} — importação bloqueada`,
        situacao: documento.status,
        statusFinal: documento.status
      };
    }

    if (!STATUS_ELEGIVEIS.includes(documento.status)
      && documento.status !== DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE) {
      return {
        ...base,
        valido: false,
        codigo: 'STATUS_NAO_ELEGIVEL',
        mensagem: `Status ${documento.status} não elegível para importação legada`,
        situacao: 'Não elegível',
        statusFinal: documento.status
      };
    }

    // Já possui nfeProc no repositório — não substituir
    const tipoAtual = documento.tipoDocumento || documento.tipo_documento;
    if (
      (tipoAtual === DocumentoDfeTipo.PROC_NFE || tipoAtual === DocumentoDfeTipo.NFE)
      && documento.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      && documento.status !== DocumentoFiscalStatus.XML_INDISPONIVEL
    ) {
      return {
        ...base,
        valido: false,
        codigo: 'XML_JA_EXISTENTE',
        mensagem: 'XML completo já existente — substituição proibida',
        situacao: 'XML já existente',
        statusFinal: documento.status
      };
    }

    if (ctx.dryRun) {
      return {
        ...base,
        codigo: 'PRONTO_PARA_IMPORTAR',
        mensagem: 'Dry-run — candidato elegível (persistência não executada)',
        situacao: 'Pronto para importar',
        statusFinal: documento.status
      };
    }

    try {
      let statusAtual = documento.status;
      let docAtual = documento;

      if (statusAtual === DocumentoFiscalStatus.XML_INDISPONIVEL) {
        await this._transitionService.transicionar(
          docAtual.id,
          DocumentoFiscalStatus.XML_INDISPONIVEL,
          DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE,
          {
            detalhe: [
              'RC3.4.9 — XML importado manualmente (Portal Nacional da NF-e).',
              `Arquivo: ${nome}`,
              `Usuário: ${ctx.usuarioNome || ctx.usuarioId || 'sistema'}`,
              `Data/Hora: ${agora.toISOString()}`,
              `Hash SHA-256: ${validacao.hash}`
            ].join('\n'),
            usuarioId: ctx.usuarioId,
            origem: ORIGEM_IMPORTACAO
          }
        );
        base.reaberto = true;
        statusAtual = DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE;
        docAtual = await this._documentosRepository.buscarPorId(docAtual.id);
      } else if (statusAtual === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
        await this._transitionService.transicionar(
          docAtual.id,
          DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
          DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE,
          {
            detalhe: [
              'RC3.4.9 — XML importado manualmente (Portal Nacional da NF-e).',
              `Arquivo: ${nome}`,
              `Usuário: ${ctx.usuarioNome || ctx.usuarioId || 'sistema'}`,
              `Data/Hora: ${agora.toISOString()}`,
              `Hash SHA-256: ${validacao.hash}`
            ].join('\n'),
            usuarioId: ctx.usuarioId,
            origem: ORIGEM_IMPORTACAO
          }
        );
        statusAtual = DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE;
        docAtual = await this._documentosRepository.buscarPorId(docAtual.id);
      }

      const { documento: atualizado } = await this._atualizacaoService.atualizarComXmlCompleto({
        documento: docAtual,
        xml,
        metadados: validacao.metadados,
        tipoDfe: DocumentoDfeTipo.PROC_NFE,
        origem: ORIGEM_IMPORTACAO
      });

      base.documentoAlterado = true;
      base.statusFinal = atualizado?.status || DocumentoFiscalStatus.SINCRONIZADA;

      // Timeline explícita RC3.4.9
      await this._historicoRepository.inserir({
        documentoId: docAtual.id,
        statusAnterior: DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE,
        statusNovo: DocumentoFiscalStatus.SINCRONIZADA,
        detalhe: [
          'XML importado manualmente',
          `Arquivo: ${nome}`,
          `Usuário: ${ctx.usuarioNome || ctx.usuarioId || 'sistema'}`,
          `Data: ${agora.toISOString().slice(0, 10)}`,
          `Hora: ${agora.toISOString().slice(11, 19)}`,
          `Hash: ${validacao.hash}`,
          'Origem: IMPORTAÇÃO MANUAL'
        ].join('\n')
      });

      await this._emitir(TIPOS_EVENTO.XML_IMPORTADO_MANUALMENTE, {
        descricao: `XML importado manualmente: ${nome}`,
        sucesso: true,
        resultado: 'XML_IMPORTADO_MANUALMENTE',
        documentoId: docAtual.id,
        usuarioId: ctx.usuarioId,
        detalhe: {
          nomeArquivo: nome,
          chave: validacao.chave,
          hash: validacao.hash,
          correlationId: ctx.correlationId,
          origem: 'IMPORTAÇÃO MANUAL'
        }
      });

      // Cancela wait MIRX — XML já no repositório oficial
      try {
        const xmlWait = this._obterXmlWait();
        if (typeof xmlWait.cancelar === 'function') {
          xmlWait.cancelar(docAtual.id, 'importacao_manual');
        }
        if (validacao.chave && typeof xmlWait.cancelarPorChave === 'function') {
          xmlWait.cancelarPorChave(validacao.chave, 'importacao_manual');
        }
      } catch { /* ignore */ }

      if (ctx.processarPipeline) {
        await this._emitir(TIPOS_EVENTO.PARSER_INICIADO, {
          descricao: `Parser iniciado (importação manual): ${validacao.chave}`,
          sucesso: true,
          documentoId: docAtual.id,
          usuarioId: ctx.usuarioId,
          detalhe: { correlationId: ctx.correlationId, origem: ORIGEM_IMPORTACAO }
        });

        const processado = await this._processamento.processar(docAtual.id, {
          usuarioId: ctx.usuarioId
        });

        base.parserExecutado = true;
        base.statusFinal = processado?.documento?.status || base.statusFinal;

        await this._emitir(TIPOS_EVENTO.PARSER_FINALIZADO, {
          descricao: `Parser finalizado (importação manual): ${validacao.chave}`,
          sucesso: Boolean(processado?.sucesso),
          resultado: processado?.sucesso ? 'PARSER_FINALIZADO' : 'PARSER_ERRO',
          documentoId: docAtual.id,
          usuarioId: ctx.usuarioId,
          detalhe: {
            correlationId: ctx.correlationId,
            status: base.statusFinal,
            mensagem: processado?.mensagem || null
          }
        });

        if (processado?.documento?.miipSessaoId
          || processado?.documento?.miip_sessao_id
          || processado?.possuiPendencias != null) {
          base.miipExecutado = true;
        }

        const st = base.statusFinal;
        if (
          st === DocumentoFiscalStatus.AGUARDANDO_REVISAO
          || st === DocumentoFiscalStatus.REVISADA
          || st === DocumentoFiscalStatus.PRONTA_PARA_COMPRA
          || st === DocumentoFiscalStatus.EM_COMPRA
          || st === DocumentoFiscalStatus.GRAVADA
        ) {
          base.miipExecutado = true;
        }

        if (
          st === DocumentoFiscalStatus.PRONTA_PARA_COMPRA
          || st === DocumentoFiscalStatus.EM_COMPRA
          || st === DocumentoFiscalStatus.GRAVADA
          || processado?.documento?.compraId
          || processado?.documento?.compra_id
        ) {
          base.compraCriada = true;
        }

        if (!processado?.sucesso) {
          base.mensagem = processado?.mensagem || 'XML salvo; falha no pipeline oficial';
          base.codigo = 'IMPORTADO_COM_ERRO_PIPELINE';
          base.situacao = 'Importado — erro no pipeline';
          return base;
        }
      }

      base.codigo = 'IMPORTADO';
      base.mensagem = 'XML legado importado via pipeline oficial';
      base.situacao = 'Importado';
      return base;
    } catch (error) {
      logCentral('RC349', {
        evento: 'DOC_ERRO',
        documentoId: base.documentoId,
        correlationId: ctx.correlationId,
        erro: error.message
      });
      await this._emitir(TIPOS_EVENTO.XML_REJEITADO, {
        descricao: `Falha na importação: ${nome}`,
        sucesso: false,
        resultado: 'ERRO_IMPORTACAO',
        documentoId: base.documentoId,
        usuarioId: ctx.usuarioId,
        detalhe: { erro: error.message, correlationId: ctx.correlationId }
      });
      return {
        ...base,
        valido: false,
        codigo: 'ERRO_IMPORTACAO',
        mensagem: error.message || 'Erro ao importar XML legado',
        situacao: 'Erro'
      };
    }
  }

  /** @private */
  async _atualizarSaude(correlationId) {
    try {
      const health = require('../health');
      if (typeof health.forcarScan === 'function') {
        await health.forcarScan({
          forcar: true,
          motivo: 'RC3.4.9',
          correlationId,
          autoRecuperar: true
        });
      }
    } catch {
      /* Health é observabilidade; falha não aborta o lote. */
    }
  }
}

module.exports = CentralImportacaoXmlLegadoService;
module.exports.STATUS_ELEGIVEIS = STATUS_ELEGIVEIS;
module.exports.ORIGEM_IMPORTACAO = ORIGEM_IMPORTACAO;
module.exports.hashXml = hashXml;
