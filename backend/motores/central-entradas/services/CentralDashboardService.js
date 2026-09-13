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
    const ultimoNsu = await this._nsuRepository.obterUltimaSincronizacao();
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
      saude
    }).toJSON();
  }
}

module.exports = CentralDashboardService;
