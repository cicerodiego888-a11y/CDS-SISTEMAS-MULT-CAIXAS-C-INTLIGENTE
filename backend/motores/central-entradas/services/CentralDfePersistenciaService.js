/**
 * CentralDfePersistenciaService — Persistência DistDFe (RC6.x / RC3.7.1).
 *
 * RES_NFE → RESUMO_RECEBIDO
 * PROC_NFE sobre resumo/XML_INDISPONIVEL → atualiza mesmo registro → XML_COMPLETO
 * Evento 110111 → CANCELADA
 */

'use strict';

const { DocumentoFiscalStatus, normalizarStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const { resolverDb, criarDbHelpers } = require('../repositories/dbHelpers');
const { extrairMetadadosNota, detectarNfCancelada, extrairChave } = require('../../../services/fiscal/dfeXmlMetadados');
const DocumentoDfeClassifier = require('./DocumentoDfeClassifier');
const CentralDocumentoAtualizacaoService = require('./CentralDocumentoAtualizacaoService');
const DocumentoTransitionService = require('./DocumentoTransitionService');
const { logCentral } = require('../utils/centralLog');

const DETALHE_RES_NFE = 'Resumo DF-e recebido. Aguardando XML completo.';

const TIPOS_XML_COMPLETO = Object.freeze([
  DocumentoDfeTipo.PROC_NFE,
  DocumentoDfeTipo.NFE
]);

const STATUS_PERMITE_XML_COMPLETO = Object.freeze([
  DocumentoFiscalStatus.RESUMO_RECEBIDO,
  DocumentoFiscalStatus.XML_INDISPONIVEL
]);

class CentralDfePersistenciaService {
  constructor(deps = {}) {
    this._db = deps.db ?? null;
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: this._db });
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository({ db: this._db });
    this._transitionService = deps.transitionService
      ?? new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository
      });
    this._atualizacaoService = deps.atualizacaoService
      ?? new CentralDocumentoAtualizacaoService({
        db: this._db,
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository,
        transitionService: this._transitionService
      });
  }

  _obterSql() {
    return criarDbHelpers(resolverDb(this._db));
  }

  async existeCompraComChave(chave) {
    if (!chave) return false;
    const sql = this._obterSql();
    await sql.whenReady();
    const row = await sql.get(
      'SELECT id FROM compras WHERE chave_acesso = ? LIMIT 1',
      [chave]
    );
    return Boolean(row);
  }

  /**
   * Aplica evento fiscal DistDFe (cancelamento / denegação) no documento da chave.
   * @param {Object} dados
   * @param {string} dados.xml
   * @param {string} [dados.nsu]
   * @param {string} [dados.origem]
   */
  async aplicarEventoDfe(dados = {}) {
    const xml = dados.xml || '';
    const chave = extrairChave(xml) || String(dados.chave || '').replace(/\D/g, '');
    if (!chave) {
      return { aplicado: false, ignorado: true, motivo: 'Evento sem chave' };
    }

    let statusNovo = null;
    let detalhe = 'Evento DF-e aplicado';
    if (detectarNfCancelada(xml) || /<tpEvento>110111<\/tpEvento>/i.test(xml)
      || /<tpEvento>110112<\/tpEvento>/i.test(xml)) {
      statusNovo = DocumentoFiscalStatus.CANCELADA;
      detalhe = 'NF-e cancelada (evento 110111/110112)';
    } else if (/<tpEvento>110140<\/tpEvento>/i.test(xml) || /denegad/i.test(xml)) {
      statusNovo = DocumentoFiscalStatus.DENEGADA;
      detalhe = 'NF-e denegada (evento DF-e)';
    }

    if (!statusNovo) {
      return { aplicado: false, ignorado: true, motivo: 'Evento sem efeito de status', chave };
    }

    const existente = await this._documentosRepository.buscarPorChave(chave);
    if (!existente) {
      return { aplicado: false, ignorado: true, motivo: 'Documento não encontrado para evento', chave };
    }

    const atual = normalizarStatus(existente.status);
    if (atual === statusNovo) {
      return { aplicado: false, duplicado: true, documento: existente, chave };
    }

    await this._transitionService.transicionar(
      existente.id,
      atual,
      statusNovo,
      { detalhe, origem: dados.origem || 'dfe_evento' }
    );

    if (dados.nsu) {
      await this._documentosRepository.atualizar(existente.id, {
        nsu: dados.nsu,
        statusDetalhe: detalhe
      });
    } else {
      await this._documentosRepository.atualizar(existente.id, { statusDetalhe: detalhe });
    }

    const documento = await this._documentosRepository.buscarPorId(existente.id);
    logCentral('DFE', {
      mensagem: 'Evento DF-e aplicado',
      chave,
      Status: statusNovo
    });

    return {
      aplicado: true,
      cancelado: statusNovo === DocumentoFiscalStatus.CANCELADA,
      documento,
      chave,
      status: statusNovo
    };
  }

  async persistirDocumentoDfe(dados) {
    const tipoDfe = DocumentoDfeClassifier.classificar(dados.xml);
    logCentral('DFE', {
      mensagem: 'Documento DF-e classificado',
      Tipo: tipoDfe
    });

    const metadados = extrairMetadadosNota(dados.xml);
    const chave = metadados.chave;

    if (!chave) {
      return {
        novo: false,
        duplicado: false,
        ignorado: true,
        documento: null,
        motivo: 'XML sem chave de acesso identificável',
        tipoDfe
      };
    }

    // Situação no resumo (cSitNFe): 2 denegada, 3 cancelada (comum em resNFe)
    const sit = String(metadados.situacaoNfe || '').trim();
    if (sit === '3' || detectarNfCancelada(dados.xml)) {
      const existenteCancel = await this._documentosRepository.buscarPorChave(chave);
      if (existenteCancel) {
        const ev = await this.aplicarEventoDfe({
          xml: dados.xml,
          chave,
          nsu: dados.nsu,
          origem: dados.origem
        });
        if (ev.aplicado) {
          return {
            novo: false,
            atualizado: true,
            duplicado: false,
            ignorado: false,
            documento: ev.documento,
            tipoDfe,
            motivo: ev.documento?.statusDetalhe || 'Cancelada'
          };
        }
      }
    }

    const existente = await this._documentosRepository.buscarPorChave(chave);
    if (existente) {
      const statusAtual = normalizarStatus(existente.status);
      const ehXmlCompleto = TIPOS_XML_COMPLETO.includes(tipoDfe);
      const podeAtualizarXml = STATUS_PERMITE_XML_COMPLETO.includes(statusAtual);

      if (podeAtualizarXml && ehXmlCompleto) {
        const { documento } = await this._atualizacaoService.atualizarComXmlCompleto({
          documento: { ...existente, status: statusAtual },
          xml: dados.xml,
          metadados,
          tipoDfe,
          nsu: dados.nsu,
          origem: dados.origem
        });

        return {
          novo: false,
          atualizado: true,
          duplicado: false,
          ignorado: false,
          documento,
          tipoDfe,
          motivo: 'XML completo aplicado ao documento existente'
        };
      }

      // Já importada / finalizada — não duplicar
      if ([DocumentoFiscalStatus.IMPORTADA, DocumentoFiscalStatus.FINALIZADA,
        DocumentoFiscalStatus.CANCELADA, DocumentoFiscalStatus.DENEGADA,
        DocumentoFiscalStatus.INUTILIZADA].includes(statusAtual)) {
        return {
          novo: false,
          duplicado: true,
          ignorado: false,
          documento: existente,
          motivo: `Documento já em estado ${statusAtual}`,
          tipoDfe
        };
      }

      // Mesmo tipo resumo novamente
      if (tipoDfe === DocumentoDfeTipo.RES_NFE && statusAtual === DocumentoFiscalStatus.RESUMO_RECEBIDO) {
        return {
          novo: false,
          duplicado: true,
          ignorado: false,
          documento: existente,
          motivo: 'Resumo já recebido',
          tipoDfe
        };
      }

      return {
        novo: false,
        duplicado: true,
        ignorado: false,
        documento: existente,
        motivo: 'Documento já existente na Central',
        tipoDfe
      };
    }

    const jaComprada = await this.existeCompraComChave(chave);
    const ehResumoDfe = tipoDfe === DocumentoDfeTipo.RES_NFE;

    let status;
    let statusDetalhe = null;
    let detalheHistorico;

    if (jaComprada) {
      status = DocumentoFiscalStatus.IMPORTADA;
      statusDetalhe = 'NF-e já registrada em compras';
      detalheHistorico = statusDetalhe;
    } else if (sit === '2') {
      status = DocumentoFiscalStatus.DENEGADA;
      statusDetalhe = 'NF-e denegada (resumo DF-e)';
      detalheHistorico = statusDetalhe;
    } else if (sit === '3') {
      status = DocumentoFiscalStatus.CANCELADA;
      statusDetalhe = 'NF-e cancelada (resumo DF-e)';
      detalheHistorico = statusDetalhe;
    } else if (ehResumoDfe) {
      status = DocumentoFiscalStatus.RESUMO_RECEBIDO;
      statusDetalhe = DETALHE_RES_NFE;
      detalheHistorico = DETALHE_RES_NFE;
    } else {
      status = DocumentoFiscalStatus.XML_COMPLETO;
      detalheHistorico = dados.origem === 'consulta_chave'
        ? 'Documento recebido via consulta por chave DF-e'
        : dados.origem === 'upload_manual'
          ? 'Documento recebido via upload manual de XML'
          : 'Documento recebido via Distribuição DF-e';
    }

    const documento = await this._documentosRepository.inserir({
      chave,
      numero: metadados.numero,
      serie: metadados.serie,
      modelo: metadados.modelo,
      fornecedor: metadados.fornecedor,
      cnpjFornecedor: metadados.cnpjFornecedor,
      dataEmissao: metadados.dataEmissao,
      dataEntrada: metadados.dataEntrada,
      valorTotal: metadados.valorTotal,
      xml: dados.xml,
      nsu: dados.nsu ?? null,
      origem: dados.origem,
      status,
      statusDetalhe,
      tipoDocumento: tipoDfe
    });

    await this._historicoRepository.inserir({
      documentoId: documento.id,
      statusAnterior: null,
      statusNovo: status,
      detalhe: detalheHistorico
    });

    const documentoNovo = status === DocumentoFiscalStatus.XML_COMPLETO
      || status === DocumentoFiscalStatus.RESUMO_RECEBIDO;

    if (documentoNovo) {
      const { emitirDocumentoRecebido } = require('../utils/centralEventosEmitter');
      emitirDocumentoRecebido(documento, dados.origem || 'dfe').catch(() => {});
    }

    return {
      novo: documentoNovo,
      atualizado: false,
      duplicado: status === DocumentoFiscalStatus.IMPORTADA && jaComprada,
      ignorado: false,
      documento,
      tipoDfe
    };
  }
}

CentralDfePersistenciaService.DETALHE_RES_NFE = DETALHE_RES_NFE;
CentralDfePersistenciaService.TIPOS_XML_COMPLETO = TIPOS_XML_COMPLETO;

module.exports = CentralDfePersistenciaService;
