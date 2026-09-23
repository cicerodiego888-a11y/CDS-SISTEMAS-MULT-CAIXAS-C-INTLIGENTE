/**
 * CentralDashboardService — Agregação de KPIs do dashboard.
 *
 * Sprint 4: inclui metadados de sincronização DF-e.
 *
 * @class CentralDashboardService
 */

const CentralDashboardDTO = require('../contracts/CentralDashboardDTO');
const { TODOS } = require('../core/DocumentoFiscalStatus');
const { montarContadoresFilas } = require('../core/FilasEstadosCentral');
const CentralNsuRepository = require('../repositories/CentralNsuRepository');

class CentralDashboardService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   * @param {import('../repositories/CentralNsuRepository')} [deps.nsuRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    /** @private */
    this._nsuRepository = deps.nsuRepository ?? new CentralNsuRepository();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterResumo() {
    const contadoresPorStatus = await this._documentosRepository.contarPorStatus({});
    let ultimoNsu = null;
    try {
      const cfg = new (require('./CentralConfiguracaoService'))();
      const ctx = await cfg.obterContextoOperacional();
      if (ctx.ok) {
        ultimoNsu = await this._nsuRepository.buscarPorCnpjAmbiente(
          String(ctx.contexto.cnpj || '').replace(/\D/g, ''),
          Number(ctx.contexto.ambiente) === 1 ? 1 : 2
        );
      }
    } catch { /* fallback */ }
    if (!ultimoNsu) {
      ultimoNsu = await this._nsuRepository.obterUltimaSincronizacao();
    }
    const estatisticas = await this._documentosRepository.obterEstatisticas();

    const contadores = {};
    TODOS.forEach((status) => {
      contadores[status] = contadoresPorStatus[status] || 0;
    });
    // Inclui legados ainda não migrados (somados após normalização no repository se houver)
    Object.keys(contadoresPorStatus || {}).forEach((k) => {
      if (contadores[k] == null) contadores[k] = contadoresPorStatus[k] || 0;
    });

    const total = Object.values(contadores).reduce((acc, n) => acc + Number(n || 0), 0);
    const filas = montarContadoresFilas(contadores);

    let saude = null;
    try {
      const health = require('../health');
      saude = await health.obterMonitor().obterPainel({ forcar: false });
    } catch {
      saude = null;
    }

    let reconcilicao = null;
    try {
      if (ultimoNsu?.cnpj) {
        const { MotorReconcilicaoDfe } = require('../../../services/fiscal/descoberta-nsu');
        const motor = new MotorReconcilicaoDfe({
          nsuRepository: this._nsuRepository,
          documentosRepository: this._documentosRepository
        });
        const snap = motor.obterUltimoSnapshot(ultimoNsu.cnpj, ultimoNsu.ambiente);
        if (snap) {
          reconcilicao = {
            titulo: 'RECONCILIAÇÃO DA CENTRAL',
            origem: 'snapshot',
            executadoEm: snap.executadoEm || snap.snapshotEm,
            status: snap.status,
            statusLabel: snap.statusLabel,
            indicadores: snap.indicadoresDashboard,
            somenteDiagnostico: true
          };
        } else {
          const resumo = await motor.obterResumo(ultimoNsu.cnpj, ultimoNsu.ambiente, {
            cursor: ultimoNsu,
            periodo: 'ultima_sincronizacao'
          });
          reconcilicao = {
            titulo: 'RECONCILIAÇÃO DA CENTRAL',
            origem: 'resumo',
            executadoEm: resumo.executadoEm,
            reconciliationId: resumo.reconciliationId,
            status: resumo.status,
            statusLabel: resumo.statusLabel,
            indicadores: resumo.indicadoresDashboard,
            cursor: resumo.cursor,
            resumo: resumo.resumo,
            somenteDiagnostico: true
          };
        }
      }
    } catch {
      reconcilicao = null;
    }

    let operacao = {
      modo: 'ASSISTIDO',
      modoLabel: 'Assistido',
      modoVisual: 'amarelo',
      acoesAguardandoConfirmacao: 0,
      pendentes: [],
      resumo: {
        ultNsu: ultimoNsu?.ultNsu || null,
        maxNsu: ultimoNsu?.maxNsu || null,
        xmlPendentes: reconcilicao?.indicadores?.xmlPendentes ?? null,
        documentosPosteriores: reconcilicao?.indicadores?.documentosPosteriores ?? null,
        possiveisLacunas: reconcilicao?.indicadores?.possiveisIntervalosNsu
          ?? reconcilicao?.indicadores?.possiveisLacunas ?? null,
        possiveisIntervalosNsu: reconcilicao?.indicadores?.possiveisIntervalosNsu
          ?? reconcilicao?.indicadores?.possiveisLacunas ?? null,
        posicoesNaoObservadas: reconcilicao?.indicadores?.posicoesNaoObservadas ?? null,
        inconsistencias: reconcilicao?.indicadores?.inconsistencias ?? null,
        acoesAguardandoConfirmacao: 0
      }
    };
    try {
      const { obterOrchestratorOperacao } = require('../../../services/fiscal/central');
      const orch = obterOrchestratorOperacao();
      const painel = await orch.obterPainelDashboard(
        ultimoNsu?.cnpj || null,
        ultimoNsu?.ambiente != null ? Number(ultimoNsu.ambiente) : null
      );
      operacao = {
        ...painel,
        resumo: {
          ultNsu: ultimoNsu?.ultNsu || null,
          maxNsu: ultimoNsu?.maxNsu || null,
          xmlPendentes: reconcilicao?.indicadores?.xmlPendentes ?? null,
          documentosPosteriores: reconcilicao?.indicadores?.documentosPosteriores ?? null,
          possiveisLacunas: reconcilicao?.indicadores?.possiveisIntervalosNsu
            ?? reconcilicao?.indicadores?.possiveisLacunas ?? null,
          possiveisIntervalosNsu: reconcilicao?.indicadores?.possiveisIntervalosNsu
            ?? reconcilicao?.indicadores?.possiveisLacunas ?? null,
          posicoesNaoObservadas: reconcilicao?.indicadores?.posicoesNaoObservadas ?? null,
          inconsistencias: reconcilicao?.indicadores?.inconsistencias ?? null,
          acoesAguardandoConfirmacao: painel.acoesAguardandoConfirmacao || 0
        }
      };
    } catch { /* defaults acima */ }

    return CentralDashboardDTO.create({
      contadores: {
        ...filas,
        novas: filas.novas,
        emProcessamento: filas.emProcessamento,
        aguardandoRevisao: filas.aguardandoRevisao,
        prontasParaCompra: filas.prontasParaCompra,
        gravadas: filas.gravadas,
        erros: filas.erros,
        porStatus: contadores,
        filas,
        total
      },
      indicadores: {
        totalDocumentos: estatisticas.totalDocumentos,
        valorTotalDia: estatisticas.valorTotalDia,
        documentosHoje: estatisticas.documentosHoje
      },
      ultimaSincronizacao: ultimoNsu?.dataSincronizacao || ultimoNsu?.updatedAt || null,
      sincronizacao: ultimoNsu
        ? {
          ultNsu: ultimoNsu.ultNsu,
          maxNsu: ultimoNsu.maxNsu,
          dataSincronizacao: ultimoNsu.dataSincronizacao,
          cnpj: ultimoNsu.cnpj,
          ambiente: ultimoNsu.ambiente,
          /** RC3.7.5.3 — campos já persistidos, só para UX do cooldown 656 */
          ultimoCstat: ultimoNsu.ultimoCstat || null,
          cooldownAte: ultimoNsu.cooldownAte || null
        }
        : null,
      xmlWait: (() => {
        try {
          return require('./CentralXmlWaitScheduler').obterTelemetria();
        } catch {
          return null;
        }
      })(),
      sefazOperacional: (() => {
        try {
          const gate = require('./CentralSefazOperationalGate');
          const xmlWait = require('./CentralXmlWaitScheduler');
          const tel = xmlWait.obterTelemetria?.() || {};
          return gate.obterPainelOperacional({
            documentosAguardando: tel.documentosAguardando || 0,
            proximaConsultaPrevista: tel.proximaConsultaPrevista || null,
            quantidadeTentativas: tel.numeroTentativas || null
          });
        } catch {
          return null;
        }
      })(),
      saude,
      reconcilicao,
      operacao
    }).toJSON();
  }
}

module.exports = CentralDashboardService;
