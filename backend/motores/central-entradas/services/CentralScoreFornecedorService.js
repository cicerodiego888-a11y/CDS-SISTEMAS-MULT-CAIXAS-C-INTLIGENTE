/**
 * CentralScoreFornecedorService — Estatísticas operacionais por fornecedor.
 *
 * @class CentralScoreFornecedorService
 */

const CentralScoreDocumentoService = require('./CentralScoreDocumentoService');
const { calcularPrecisaoImportacao } = require('../../miip/utils/miipCentralRevisaoUtils');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { extrairPendencias } = require('../../miip/utils/miipCentralRevisaoUtils');

class CentralScoreFornecedorService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    /** @private */
    this._scoreService = deps.scoreService ?? new CentralScoreDocumentoService();
  }

  /**
   * @param {string} cnpj
   * @param {Object} [opcoes]
   * @returns {Promise<Object|null>}
   */
  async obterEstatisticas(cnpj, opcoes = {}) {
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    if (cnpjLimpo.length < 11) return null;

    const periodoDias = Number(opcoes.periodoDias ?? opcoes.periodo_dias ?? 90) || 90;
    const documentos = await this._documentosRepository.listarPorFornecedor(cnpjLimpo, { periodoDias });

    if (!documentos.length) {
      return {
        cnpj: cnpjLimpo,
        fornecedor: null,
        periodoDias,
        quantidadeNotas: 0,
        precisaoMediaMiip: null,
        tempoMedioLancamentoMinutos: null,
        pendencias: 0,
        ultimaNota: null,
        valorTotal: 0,
        scoreMedio: null
      };
    }

    const fornecedor = documentos[0].fornecedor || null;
    let somaPrecisao = 0;
    let contPrecisao = 0;
    let somaTempoMin = 0;
    let contTempo = 0;
    let totalPendencias = 0;
    let somaScore = 0;
    let contScore = 0;

    documentos.forEach((doc) => {
      const resumo = doc.miipResumoJson?.resumo;
      if (resumo?.totalItens) {
        somaPrecisao += calcularPrecisaoImportacao(resumo);
        contPrecisao += 1;
        totalPendencias += extrairPendencias(doc.miipResumoJson?.resultados || []).length;
      }

      if (doc.createdAt && doc.processadoEm) {
        const diff = new Date(doc.processadoEm).getTime() - new Date(doc.createdAt).getTime();
        if (diff > 0) {
          somaTempoMin += diff / 60000;
          contTempo += 1;
        }
      } else if (doc.status === DocumentoFiscalStatus.GRAVADA && doc.createdAt) {
        const diff = Date.now() - new Date(doc.createdAt).getTime();
        if (diff > 0) {
          somaTempoMin += diff / 60000;
          contTempo += 1;
        }
      }

      const score = this._scoreService.calcular(doc);
      if (score.scoreGeral != null) {
        somaScore += score.scoreGeral;
        contScore += 1;
      }
    });

    const ultimo = documentos.reduce((acc, doc) => {
      if (!acc) return doc;
      return new Date(doc.createdAt) > new Date(acc.createdAt) ? doc : acc;
    }, null);

    const valorTotal = documentos.reduce((acc, d) => acc + Number(d.valorTotal || 0), 0);

    return {
      cnpj: cnpjLimpo,
      fornecedor,
      periodoDias,
      quantidadeNotas: documentos.length,
      precisaoMediaMiip: contPrecisao > 0 ? Math.round(somaPrecisao / contPrecisao) : null,
      tempoMedioLancamentoMinutos: contTempo > 0
        ? Math.round(somaTempoMin / contTempo)
        : null,
      pendencias: totalPendencias,
      ultimaNota: ultimo
        ? {
          id: ultimo.id,
          dataEmissao: ultimo.dataEmissao,
          createdAt: ultimo.createdAt,
          status: ultimo.status,
          valorTotal: ultimo.valorTotal
        }
        : null,
      valorTotal,
      scoreMedio: contScore > 0 ? Math.round(somaScore / contScore) : null
    };
  }
}

module.exports = CentralScoreFornecedorService;
