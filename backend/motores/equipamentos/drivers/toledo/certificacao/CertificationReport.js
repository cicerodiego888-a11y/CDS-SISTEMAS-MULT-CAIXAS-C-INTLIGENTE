/**
 * Sprint 14.12 / RC15.0.1 — Relatório consolidado de certificação
 */

'use strict';

const { diagnostics } = require('./ToledoDiagnostics');
const { getVersion } = require('./ToledoVersion');

async function buildCertificationReport(opcoes = {}) {
  // Certificação estrutural não precisa abrir socket por padrão
  const diag = await diagnostics({
    ...opcoes,
    probe: opcoes.probe === true
  });
  const version = getVersion();

  return {
    titulo: 'Certificação e Homologação — Toledo Prix IV Uno V2.0',
    versao: version,
    resumo: {
      arquiteturaOk: diag.arquitetura.success,
      homologado: diag.checklist.homologado,
      prontoProducao: diag.homologacao.prontoProducao,
      modulosOk: `${diag.arquitetura.ok}/${diag.arquitetura.total}`,
      checklistOk: `${diag.checklist.resumo.ok}/${diag.checklist.resumo.total}`
    },
    performance: diag.performance,
    checklist: diag.checklist,
    arquitetura: diag.arquitetura.resultados.map((r) => ({
      modulo: r.nome,
      status: r.status
    })),
    capacidades: diag.capabilities,
    etapas_conexao: diag.etapas_conexao,
    geradoEm: new Date().toISOString()
  };
}

module.exports = {
  buildCertificationReport
};
