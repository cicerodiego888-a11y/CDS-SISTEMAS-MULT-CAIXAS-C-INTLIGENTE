/**
 * RC4.31.8 — Métricas da homologação operacional da Central Inteligente
 * @module certification/CentralInteligenteHomologacaoMetrics
 */
'use strict';

const { ReleaseCertificationMetrics } = require('./ReleaseCertificationMetrics');

class CentralInteligenteHomologacaoMetrics extends ReleaseCertificationMetrics {
  constructor() {
    super();
    this.xmlsProcessados = 0;
    this.produtosIdentificadosAuto = 0;
    this.produtosAssociadosManual = 0;
    this.comprasGravadas = 0;
    this.temposProcessamentoMs = [];
    this.xmlsUtilizados = [];
  }

  registrarXml(meta) {
    this.xmlsProcessados += 1;
    if (meta) this.xmlsUtilizados.push(meta);
  }

  registrarTempoProcessamento(ms) {
    if (Number.isFinite(ms) && ms >= 0) {
      this.temposProcessamentoMs.push(Math.round(ms));
    }
  }

  tempoMedioProcessamentoMs() {
    if (!this.temposProcessamentoMs.length) return 0;
    const soma = this.temposProcessamentoMs.reduce((a, b) => a + b, 0);
    return Math.round(soma / this.temposProcessamentoMs.length);
  }

  exportarEstatisticas() {
    const base = this.resumo();
    return {
      ...base,
      xmlsProcessados: this.xmlsProcessados,
      produtosIdentificadosAutomaticamente: this.produtosIdentificadosAuto,
      produtosAssociadosManualmente: this.produtosAssociadosManual,
      comprasGravadas: this.comprasGravadas,
      tempoMedioProcessamentoMs: this.tempoMedioProcessamentoMs(),
      tempoMedioProcessamentoSeg: Math.round(this.tempoMedioProcessamentoMs() / 10) / 100
    };
  }
}

module.exports = { CentralInteligenteHomologacaoMetrics };
