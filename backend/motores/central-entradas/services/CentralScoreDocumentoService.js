/**
 * CentralScoreDocumentoService — Cálculo isolado do Score Geral do documento.
 *
 * Sprint 7: inteligência operacional (somente leitura).
 * Considera: precisão MIIP, pendências, status, erros e tempo de processamento.
 *
 * @class CentralScoreDocumentoService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { calcularPrecisaoImportacao } = require('../../miip/utils/miipCentralRevisaoUtils');

const PESOS = Object.freeze({
  precisaoMiip: 0.40,
  pendencias: 0.25,
  status: 0.20,
  erros: 0.10,
  tempo: 0.05
});

const SCORE_POR_STATUS = Object.freeze({
  [DocumentoFiscalStatus.GRAVADA]: 100,
  [DocumentoFiscalStatus.PRONTA_PARA_COMPRA]: 95,
  [DocumentoFiscalStatus.REVISADA]: 90,
  [DocumentoFiscalStatus.EM_COMPRA]: 85,
  [DocumentoFiscalStatus.EM_PROCESSAMENTO]: 70,
  [DocumentoFiscalStatus.AGUARDANDO_REVISAO]: 65,
  [DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO]: 55,
  [DocumentoFiscalStatus.SINCRONIZADA]: 60,
  [DocumentoFiscalStatus.RECEBIDA]: 55,
  [DocumentoFiscalStatus.ERRO]: 15,
  [DocumentoFiscalStatus.DUPLICADA]: 25,
  [DocumentoFiscalStatus.DESCARTADA]: 0,
  [DocumentoFiscalStatus.XML_INDISPONIVEL]: 0
});

class CentralScoreDocumentoService {
  /**
   * @param {Object|null} documento — registro bruto do repositório
   * @returns {{ scoreGeral: number|null, cor: string, fatores: Object[], detalhes: Object }}
   */
  calcular(documento) {
    if (!documento) {
      return {
        scoreGeral: null,
        cor: '#94a3b8',
        fatores: [],
        detalhes: {}
      };
    }

    const fatores = [];
    const resumo = documento.miipResumoJson?.resumo || {};
    const totalItens = Number(resumo.totalItens ?? 0);

    if (totalItens > 0 || documento.miipResumoJson) {
      const precisaoMiip = calcularPrecisaoImportacao(resumo);
      fatores.push({ nome: 'precisaoMiip', valor: precisaoMiip, peso: PESOS.precisaoMiip });

      const pendencias = Number(resumo.precisamConfirmacao ?? 0)
        + Number(resumo.precisamCadastro ?? 0);
      const taxaSemPendencia = totalItens > 0
        ? Math.round(((totalItens - pendencias) / totalItens) * 100)
        : 100;
      fatores.push({ nome: 'pendencias', valor: taxaSemPendencia, peso: PESOS.pendencias });
    }

    const statusScore = SCORE_POR_STATUS[documento.status] ?? 50;
    fatores.push({ nome: 'status', valor: statusScore, peso: PESOS.status });

    let erroScore = 100;
    if (documento.status === DocumentoFiscalStatus.ERRO) {
      erroScore = 0;
    } else if (documento.statusDetalhe) {
      erroScore = 60;
    }
    fatores.push({ nome: 'erros', valor: erroScore, peso: PESOS.erros });

    const tempoScore = this._calcularScoreTempo(documento);
    fatores.push({ nome: 'tempo', valor: tempoScore, peso: PESOS.tempo });

    const totalPeso = fatores.reduce((acc, f) => acc + f.peso, 0);
    const scoreBruto = totalPeso > 0
      ? fatores.reduce((acc, f) => acc + f.valor * f.peso, 0) / totalPeso
      : statusScore;

    const scoreGeral = Math.max(0, Math.min(100, Math.round(scoreBruto)));

    return {
      scoreGeral,
      cor: this._corParaScore(scoreGeral),
      fatores,
      detalhes: {
        precisaoMiip: totalItens > 0 ? calcularPrecisaoImportacao(resumo) : null,
        pendencias: Number(resumo.precisamConfirmacao ?? 0) + Number(resumo.precisamCadastro ?? 0),
        status: documento.status,
        possuiErro: documento.status === DocumentoFiscalStatus.ERRO,
        tempoScore
      }
    };
  }

  /**
   * @private
   * @param {Object} documento
   * @returns {number}
   */
  _calcularScoreTempo(documento) {
    const referencia = documento.processadoEm || documento.createdAt;
    if (!referencia) return 100;

    const inicio = new Date(referencia).getTime();
    if (Number.isNaN(inicio)) return 100;

    const dias = Math.max(0, (Date.now() - inicio) / 86400000);

    if (documento.status === DocumentoFiscalStatus.AGUARDANDO_REVISAO && dias > 1) {
      return Math.max(30, Math.round(100 - dias * 8));
    }

    if (documento.status === DocumentoFiscalStatus.SINCRONIZADA && !documento.processadoEm && dias > 0.5) {
      return Math.max(40, Math.round(100 - dias * 12));
    }

    if (documento.status === DocumentoFiscalStatus.EM_COMPRA && dias > 2) {
      return Math.max(50, Math.round(100 - dias * 5));
    }

    return 100;
  }

  /**
   * @param {number} score
   * @returns {string}
   */
  _corParaScore(score) {
    if (score >= 90) return '#198754';
    if (score >= 75) return '#0d6efd';
    if (score >= 60) return '#fd7e14';
    return '#dc3545';
  }
}

module.exports = CentralScoreDocumentoService;
