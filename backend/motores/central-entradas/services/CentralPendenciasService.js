/**
 * CentralPendenciasService — Central de pendências operacionais.
 *
 * @class CentralPendenciasService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const CentralAlertasService = require('./CentralAlertasService');
const { extrairPendencias } = require('../../miip/utils/miipCentralRevisaoUtils');

class CentralPendenciasService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    const documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();

    /** @private */
    this._documentosRepository = documentosRepository;
    /** @private */
    this._alertasService = deps.alertasService
      ?? new CentralAlertasService({ documentosRepository, nsuRepository: deps.nsuRepository });
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async obterPendencias(opcoes = {}) {
    const limite = Math.min(Number(opcoes.limite) || 30, 100);

    const [
      aguardandoRevisao,
      comprasAbertas,
      erros,
      xmlInvalido,
      alertasResultado
    ] = await Promise.all([
      this._documentosRepository.listarPorStatus(DocumentoFiscalStatus.AGUARDANDO_REVISAO, limite),
      this._documentosRepository.listarComprasAbertas(limite),
      this._documentosRepository.listarPorStatus(DocumentoFiscalStatus.ERRO, limite),
      this._documentosRepository.listarXmlInvalido(limite),
      opcoes.alertasResultado
        ? Promise.resolve(opcoes.alertasResultado)
        : this._alertasService.listarAlertas()
    ]);

    const falhasSincronizacao = (alertasResultado.alertas || [])
      .filter((a) => a.tipo === 'FALHA_SINCRONIZACAO');

    const resumo = {
      aguardandoRevisao: aguardandoRevisao.length,
      comprasAbertas: comprasAbertas.length,
      erros: erros.length,
      xmlInvalido: xmlInvalido.length,
      falhasSincronizacao: falhasSincronizacao.length,
      alertas: alertasResultado.alertas?.length || 0,
      total: aguardandoRevisao.length
        + comprasAbertas.length
        + erros.length
        + xmlInvalido.length
        + falhasSincronizacao.length
    };

    return {
      resumo,
      secoes: {
        aguardandoRevisao: this._mapearSecao(aguardandoRevisao),
        comprasAbertas: this._mapearSecao(comprasAbertas),
        erros: this._mapearSecao(erros),
        xmlInvalido: this._mapearSecao(xmlInvalido),
        falhasSincronizacao,
        alertas: alertasResultado.alertas || []
      }
    };
  }

  /**
   * @private
   * @param {Object[]} documentos
   * @returns {Object[]}
   */
  _mapearSecao(documentos) {
    return documentos.map((doc) => {
      const resumo = doc.miipResumoJson?.resumo || {};
      const pendenciasMiip = extrairPendencias(doc.miipResumoJson?.resultados || []).length;

      return {
        documentoId: doc.id,
        chave: doc.chave,
        fornecedor: doc.fornecedor,
        cnpjFornecedor: doc.cnpjFornecedor,
        status: doc.status,
        statusDetalhe: doc.statusDetalhe,
        valorTotal: doc.valorTotal,
        createdAt: doc.createdAt,
        processadoEm: doc.processadoEm,
        compraId: doc.compraId,
        miip: {
          totalItens: resumo.totalItens ?? 0,
          precisamConfirmacao: resumo.precisamConfirmacao ?? 0,
          precisamCadastro: resumo.precisamCadastro ?? 0,
          pendenciasMiip
        }
      };
    });
  }
}

module.exports = CentralPendenciasService;
