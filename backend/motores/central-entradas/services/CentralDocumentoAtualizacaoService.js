/**
 * CentralDocumentoAtualizacaoService — Aplica XML completo no mesmo registro (RC6.3 / RC3.7.1).
 *
 * Origens: RESUMO_RECEBIDO, XML_INDISPONIVEL (e aliases legados).
 * Destino: XML_COMPLETO. Nunca cria outro registro.
 */

'use strict';

const { DocumentoFiscalStatus, normalizarStatus } = require('../core/DocumentoFiscalStatus');
const DocumentoTransitionService = require('./DocumentoTransitionService');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const { logCentral } = require('../utils/centralLog');

const DETALHE_XML_COMPLETO = 'XML completo recebido.';
const DETALHE_DOCUMENTO_ATUALIZADO = 'Documento atualizado.';

const STATUS_ORIGEM_XML_COMPLETO = Object.freeze([
  DocumentoFiscalStatus.RESUMO_RECEBIDO,
  DocumentoFiscalStatus.XML_INDISPONIVEL,
  DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
  DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE
]);

class CentralDocumentoAtualizacaoService {
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: deps.db ?? null });
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository({ db: deps.db ?? null });
    this._transitionService = deps.transitionService
      ?? new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository
      });
  }

  async atualizarComXmlCompleto(params = {}) {
    const documento = params.documento;
    if (!documento?.id) {
      const erro = new Error('Documento existente é obrigatório para atualização.');
      erro.statusCode = 400;
      throw erro;
    }

    const statusOrigem = normalizarStatus(documento.status);
    const origemOk = STATUS_ORIGEM_XML_COMPLETO.map(normalizarStatus).includes(statusOrigem);
    if (!origemOk) {
      const erro = new Error(
        `Atualização com XML completo só é permitida em RESUMO_RECEBIDO ou XML_INDISPONIVEL (atual: ${statusOrigem})`
      );
      erro.statusCode = 400;
      throw erro;
    }

    const xml = params.xml;
    if (!xml) {
      const erro = new Error('XML completo é obrigatório.');
      erro.statusCode = 400;
      throw erro;
    }

    const metadados = params.metadados || {};
    const tipoDfe = params.tipoDfe || null;

    await this._documentosRepository.atualizar(documento.id, {
      xml,
      nsu: params.nsu != null ? params.nsu : documento.nsu,
      numero: metadados.numero || documento.numero,
      serie: metadados.serie || documento.serie,
      modelo: metadados.modelo ?? documento.modelo,
      fornecedor: metadados.fornecedor || documento.fornecedor,
      cnpjFornecedor: metadados.cnpjFornecedor || documento.cnpjFornecedor,
      dataEmissao: metadados.dataEmissao || documento.dataEmissao,
      dataEntrada: metadados.dataEntrada || documento.dataEntrada,
      valorTotal: metadados.valorTotal != null ? metadados.valorTotal : documento.valorTotal,
      tipoDocumento: tipoDfe,
      parseJson: null,
      miipSessaoId: null,
      miipResumoJson: null,
      processadoEm: null,
      statusDetalhe: DETALHE_XML_COMPLETO
    });

    await this._transitionService.transicionar(
      documento.id,
      statusOrigem,
      DocumentoFiscalStatus.XML_COMPLETO,
      {
        detalhe: DETALHE_XML_COMPLETO,
        origem: params.origem || null
      }
    );

    await this._historicoRepository.inserir({
      documentoId: documento.id,
      statusAnterior: DocumentoFiscalStatus.XML_COMPLETO,
      statusNovo: DocumentoFiscalStatus.XML_COMPLETO,
      detalhe: DETALHE_DOCUMENTO_ATUALIZADO
    });

    const atualizado = await this._documentosRepository.buscarPorId(documento.id);

    logCentral('DFE', {
      mensagem: 'Documento atualizado com XML completo',
      documentoId: documento.id,
      Tipo: tipoDfe,
      Status: DocumentoFiscalStatus.XML_COMPLETO
    });

    try {
      const { emitirDocumentoAtualizado } = require('../utils/centralEventosEmitter');
      await emitirDocumentoAtualizado(atualizado, {
        origem: params.origem || 'dfe',
        tipoDfe
      });
    } catch { /* ignore */ }

    return { documento: atualizado, atualizado: true };
  }
}

CentralDocumentoAtualizacaoService.DETALHE_XML_COMPLETO = DETALHE_XML_COMPLETO;
CentralDocumentoAtualizacaoService.DETALHE_DOCUMENTO_ATUALIZADO = DETALHE_DOCUMENTO_ATUALIZADO;
CentralDocumentoAtualizacaoService.STATUS_ORIGEM_XML_COMPLETO = STATUS_ORIGEM_XML_COMPLETO;

module.exports = CentralDocumentoAtualizacaoService;
