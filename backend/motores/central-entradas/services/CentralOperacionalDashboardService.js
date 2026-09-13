/**
 * CentralOperacionalDashboardService — Indicadores operacionais da Central.
 *
 * @class CentralOperacionalDashboardService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const CentralAlertasService = require('./CentralAlertasService');

class CentralOperacionalDashboardService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    const documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    const nsuRepository = deps.nsuRepository
      ?? new (require('../repositories/CentralNsuRepository'))();

    /** @private */
    this._documentosRepository = documentosRepository;
    /** @private */
    this._nsuRepository = nsuRepository;
    /** @private */
    this._alertasService = deps.alertasService
      ?? new CentralAlertasService({ documentosRepository, nsuRepository });
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async obterIndicadores(opcoes = {}) {
    const alertasResultado = opcoes.alertasResultado
      ?? await this._alertasService.listarAlertas();

    const filtrosPeriodo = {
      ano: opcoes.ano,
      mes: opcoes.mes,
      competencia: opcoes.competencia,
      dataEmissaoInicio: opcoes.dataEmissaoInicio || opcoes.data_emissao_inicio || null,
      dataEmissaoFim: opcoes.dataEmissaoFim || opcoes.data_emissao_fim || null
    };

    const filtrosContagem = {
      dataEmissaoInicio: filtrosPeriodo.dataEmissaoInicio,
      dataEmissaoFim: filtrosPeriodo.dataEmissaoFim
    };

    const [
      metricas,
      contadoresPorStatus
    ] = await Promise.all([
      this._documentosRepository.obterMetricasOperacionais(filtrosPeriodo),
      this._documentosRepository.contarPorStatus(filtrosContagem)
    ]);

    const pendenciasCriticas = (alertasResultado.alertas || []).filter(
      (a) => a.gravidade === 'critica' || a.gravidade === 'alta'
    ).reduce((acc, a) => acc + (a.quantidade || 0), 0);

    const ultimoNsu = await this._nsuRepository.obterUltimaSincronizacao();

    return {
      valorTotalMes: metricas.valorTotalMes,
      valorMensal: metricas.valorMensal,
      valorAnual: metricas.valorAnual,
      quantidadeMensal: metricas.quantidadeMensal,
      quantidadeAnual: metricas.quantidadeAnual,
      competencia: metricas.competencia,
      competenciaLabel: metricas.competenciaLabel,
      ambiente: metricas.ambiente,
      ambienteLabel: metricas.ambienteLabel,
      tempoMedioProcessamentoMinutos: metricas.tempoMedioProcessamentoMinutos,
      taxaIdentificacaoAutomatica: metricas.taxaIdentificacaoAutomatica,
      taxaRevisaoManual: metricas.taxaRevisaoManual,
      comprasConcluidasHoje: metricas.comprasConcluidasHoje,
      pendenciasCriticas,
      filas: {
        novas: contadoresPorStatus[DocumentoFiscalStatus.SINCRONIZADA] || 0,
        emProcessamento: contadoresPorStatus[DocumentoFiscalStatus.EM_PROCESSAMENTO] || 0,
        aguardandoRevisao: contadoresPorStatus[DocumentoFiscalStatus.AGUARDANDO_REVISAO] || 0,
        prontasParaCompra: contadoresPorStatus[DocumentoFiscalStatus.PRONTA_PARA_COMPRA] || 0,
        emCompra: contadoresPorStatus[DocumentoFiscalStatus.EM_COMPRA] || 0,
        gravadas: contadoresPorStatus[DocumentoFiscalStatus.GRAVADA] || 0,
        erros: contadoresPorStatus[DocumentoFiscalStatus.ERRO] || 0
      },
      ultimaSincronizacao: ultimoNsu?.dataSincronizacao || ultimoNsu?.updatedAt || null,
      alertasResumo: {
        total: alertasResultado.total,
        tipos: (alertasResultado.alertas || []).length
      }
    };
  }
}

module.exports = CentralOperacionalDashboardService;
