/**
 * CentralEntradasService — Fachada HTTP da Central Inteligente de Entradas.
 *
 * RC1: delega exclusivamente ao CentralEntradasOrchestrator.
 *
 * @class CentralEntradasService
 */

const orchestrator = require('./CentralEntradasOrchestrator');

class CentralEntradasService {
  /**
   * @param {Object} [deps]
   * @param {import('./CentralEntradasOrchestrator').CentralEntradasOrchestrator} [deps.orchestrator]
   */
  constructor(deps = {}) {
    /** @private */
    this._orchestrator = deps.orchestrator ?? orchestrator;
  }

  estaHabilitado() {
    return this._orchestrator.estaHabilitado();
  }

  obterHealth() {
    return this._orchestrator.obterHealth();
  }

  obterMetadados() {
    return this._orchestrator.obterMetadados();
  }

  listarDocumentos(filtros = {}) {
    return this._orchestrator.listarDocumentos(filtros);
  }

  obterDocumento(id) {
    return this._orchestrator.obterDocumento(id);
  }

  obterDocumentoDetalhe(id) {
    return this._orchestrator.obterDocumentoDetalhe(id);
  }

  obterHistorico(documentoId) {
    return this._orchestrator.obterHistorico(documentoId);
  }

  obterDashboard() {
    return this._orchestrator.obterDashboard();
  }

  /** RC3.4.6 — Health Monitor (somente diagnóstico local). */
  obterSaudeCentral(opcoes = {}) {
    return this._orchestrator.obterSaudeCentral(opcoes);
  }

  listarAlertasSaude(filtros = {}) {
    return this._orchestrator.listarAlertasSaude(filtros);
  }

  obterSaudeDocumento(id) {
    return this._orchestrator.obterSaudeDocumento(id);
  }

  analisarSaudeCentral(opcoes = {}) {
    return this._orchestrator.analisarSaudeCentral(opcoes);
  }

  alterarStatus(id, novoStatus, opcoes = {}) {
    return this._orchestrator.alterarStatusManual(id, novoStatus, opcoes);
  }

  sincronizar(opcoes = {}) {
    return this._orchestrator.sincronizar(opcoes);
  }

  sincronizarAoAbrir() {
    return this._orchestrator.sincronizarAoAbrir();
  }

  uploadDocumentos(arquivos = [], opcoes = {}) {
    return this._orchestrator.uploadDocumentos(arquivos, opcoes);
  }

  buscarPorChave(chave) {
    return this._orchestrator.buscarPorChave(chave);
  }

  obterXmlDocumento(id) {
    return this._orchestrator.obterXmlDocumento(id);
  }

  obterParseDocumento(id) {
    return this._orchestrator.obterParseDocumento(id);
  }

  processarDocumento(id, opcoes = {}) {
    return this._orchestrator.processarDocumento(id, opcoes);
  }

  processarCicloDfeDocumento(id, opcoes = {}) {
    return this._orchestrator.processarCicloDfeDocumento(id, opcoes);
  }

  /**
   * RC3.4.2 — recuperação manual excepcional (respeita Gate / SLEEP).
   */
  async solicitarXmlCompletoManual(id, opcoes = {}) {
    const xmlWait = require('./services/CentralXmlWaitScheduler');
    if (typeof xmlWait.solicitarXmlManual !== 'function') {
      return this.processarCicloDfeDocumento(id, {
        ...opcoes,
        confirmado: true
      });
    }
    return xmlWait.solicitarXmlManual(id, {
      usuarioId: opcoes.usuarioId,
      correlationId: opcoes.correlationId
    });
  }

  concluirRevisao(id, dados = {}) {
    return this._orchestrator.concluirRevisao(id, dados);
  }

  finalizarEntrada(id, dados = {}) {
    return this._orchestrator.finalizarEntrada(id, dados);
  }

  obterOuCriarSessaoRevisao(id, opcoes = {}) {
    return this._orchestrator.obterOuCriarSessaoRevisao(id, opcoes);
  }

  obterSessaoRevisao(id) {
    return this._orchestrator.obterSessaoRevisao(id);
  }

  salvarDecisaoRevisao(id, itemIndex, dados = {}) {
    return this._orchestrator.salvarDecisaoRevisao(id, itemIndex, dados);
  }

  reiniciarSessaoRevisao(id, opcoes = {}) {
    return this._orchestrator.reiniciarSessaoRevisao(id, opcoes);
  }

  obterPayloadCompra(id) {
    return this._orchestrator.obterPayloadCompra(id);
  }

  abrirCompra(id, opcoes = {}) {
    return this._orchestrator.abrirCompra(id, opcoes);
  }

  vincularCompra(documentoId, compraId, opcoes = {}) {
    return this._orchestrator.vincularCompra(documentoId, compraId, opcoes);
  }

  listarAlertas() {
    return this._orchestrator.listarAlertas();
  }

  obterPendencias(opcoes = {}) {
    return this._orchestrator.obterPendencias(opcoes);
  }

  obterOperacional(opcoes = {}) {
    return this._orchestrator.obterOperacional(opcoes);
  }

  obterItensAtencao(opcoes = {}) {
    return this._orchestrator.obterItensAtencao(opcoes);
  }

  obterInteligenciaOperacional(opcoes = {}) {
    return this._orchestrator.obterInteligenciaOperacional(opcoes);
  }

  obterScoreDocumento(id) {
    return this._orchestrator.obterScoreDocumento(id);
  }

  obterEstatisticasFornecedor(cnpj, opcoes = {}) {
    return this._orchestrator.obterEstatisticasFornecedor(cnpj, opcoes);
  }

  obterConfiguracoes() {
    return this._orchestrator.obterConfiguracoes();
  }

  obterConfiguracaoEnterprise() {
    return this._orchestrator.obterConfiguracaoEnterprise();
  }

  atualizarConfiguracoes(alteracoes) {
    return this._orchestrator.atualizarConfiguracoes(alteracoes);
  }

  restaurarConfiguracaoPadrao(opcoes = {}) {
    return this._orchestrator.restaurarConfiguracaoPadrao(opcoes);
  }

  listarEventos(filtros = {}) {
    return this._orchestrator.listarEventos(filtros);
  }

  obterStatusServico() {
    return this._orchestrator.obterStatusServico();
  }

  listarNotificacoes(filtros = {}) {
    return this._orchestrator.listarNotificacoes(filtros);
  }

  marcarNotificacaoLida(id) {
    return this._orchestrator.marcarNotificacaoLida(id);
  }

  marcarTodasNotificacoesLidas() {
    return this._orchestrator.marcarTodasNotificacoesLidas();
  }

  obterDiagnostico(opcoes = {}) {
    return this._orchestrator.obterDiagnostico(opcoes);
  }

  executarHealthCheckDiagnostico() {
    return this._orchestrator.executarHealthCheckDiagnostico();
  }

  testarCertificadoDiagnostico() {
    return this._orchestrator.testarCertificadoDiagnostico();
  }

  testarSefazDiagnostico() {
    return this._orchestrator.testarSefazDiagnostico();
  }

  limparCacheDiagnostico() {
    return this._orchestrator.limparCacheDiagnostico();
  }

  processarDocumentosPendentes(opcoes = {}) {
    return this._orchestrator.processarDocumentosPendentes(opcoes);
  }

  obterPainelHomologacao(opcoes = {}) {
    return this._orchestrator.obterPainelHomologacao(opcoes);
  }

  inspecionarDocumentoHomologacao(documentoId) {
    return this._orchestrator.inspecionarDocumentoHomologacao(documentoId);
  }

  obterMetricasHomologacao() {
    return this._orchestrator.obterMetricasHomologacao();
  }

  exportarRelatorioHomologacao(documentoId, formato = 'json') {
    return this._orchestrator.exportarRelatorioHomologacao(documentoId, formato);
  }

  /**
   * RC3.4.8 — recuperação em lote de XMLs legados (fluxo oficial MIRX).
   * @param {Object} [opcoes]
   */
  recuperarXmlLoteLegado(opcoes = {}) {
    const CentralRecuperacaoXmlLoteLegadoService = require('./services/CentralRecuperacaoXmlLoteLegadoService');
    const svc = new CentralRecuperacaoXmlLoteLegadoService();
    return svc.executar(opcoes);
  }

  /**
   * RC3.4.9 — importação manual de XML legado (Portal Nacional / nfeProc).
   * Reutiliza repositório oficial + Parser/MIIP. Não cria documento novo.
   * @param {Object[]} arquivos
   * @param {Object} [opcoes]
   */
  importarXmlLegado(arquivos = [], opcoes = {}) {
    const CentralImportacaoXmlLegadoService = require('./services/CentralImportacaoXmlLegadoService');
    const svc = new CentralImportacaoXmlLegadoService();
    return svc.executar(arquivos, opcoes);
  }

  /**
   * RC3.4.9 — análise/dry-run do lote (sem persistir).
   * @param {Object[]} arquivos
   * @param {Object} [opcoes]
   */
  analisarImportacaoXmlLegado(arquivos = [], opcoes = {}) {
    const CentralImportacaoXmlLegadoService = require('./services/CentralImportacaoXmlLegadoService');
    const svc = new CentralImportacaoXmlLegadoService();
    return svc.analisar(arquivos, opcoes);
  }

  /**
   * RC3.5.0 — elegibilidade / importação via Portal Nacional.
   */
  avaliarRecuperacaoPortalNfe(documentoId, opcoes = {}) {
    const PortalNfeRecoveryService = require('./services/PortalNfeRecoveryService');
    const svc = new PortalNfeRecoveryService();
    return svc.avaliarDocumento(documentoId, opcoes);
  }

  registrarPortalNfeAberto(documentoId, opcoes = {}) {
    const PortalNfeRecoveryService = require('./services/PortalNfeRecoveryService');
    const svc = new PortalNfeRecoveryService();
    return svc.registrarPortalAberto(documentoId, opcoes);
  }

  /** RC3.6.0 — Central de Recuperação CDS */
  registrarCentralRecuperacaoAberta(documentoId, opcoes = {}) {
    const PortalNfeRecoveryService = require('./services/PortalNfeRecoveryService');
    const svc = new PortalNfeRecoveryService();
    return svc.registrarCentralRecuperacaoAberta(documentoId, opcoes);
  }

  registrarConsultaPortalIniciada(documentoId, opcoes = {}) {
    const PortalNfeRecoveryService = require('./services/PortalNfeRecoveryService');
    const svc = new PortalNfeRecoveryService();
    return svc.registrarConsultaPortalIniciada(documentoId, opcoes);
  }

  registrarDownloadDetectadoPortalNfe(documentoId, opcoes = {}) {
    const PortalNfeRecoveryService = require('./services/PortalNfeRecoveryService');
    const svc = new PortalNfeRecoveryService();
    return svc.registrarDownloadDetectado(documentoId, opcoes);
  }

  importarXmlPortalNfe(documentoId, arquivo, opcoes = {}) {
    const PortalNfeRecoveryService = require('./services/PortalNfeRecoveryService');
    const svc = new PortalNfeRecoveryService();
    return svc.importarXmlBaixado(documentoId, arquivo, opcoes);
  }

  /** RC3.6.H — usuário copiou chave de acesso (ação independente do Portal). */
  async registrarChaveCopiada(documentoId, opcoes = {}) {
    const { emitirEvento } = require('./utils/centralEventosEmitter');
    const { TIPOS_EVENTO, ORIGENS } = require('./config/centralEventosTipos');
    const CentralHistoricoRepository = require('./repositories/CentralHistoricoRepository');
    const historicoRepository = new CentralHistoricoRepository();
    const id = Number(documentoId);
    const usuarioId = opcoes.usuarioId ?? null;
    const usuarioLabel = opcoes.usuarioNome || usuarioId || 'sistema';

    await emitirEvento({
      tipo: TIPOS_EVENTO.CHAVE_COPIADA,
      origem: ORIGENS.MANUAL,
      documentoId: id,
      usuarioId,
      descricao: 'Chave de acesso copiada pelo usuário',
      resultado: 'sucesso',
      sucesso: true
    });

    try {
      await historicoRepository.inserir({
        documentoId: id,
        statusAnterior: null,
        statusNovo: null,
        usuarioId,
        detalhe: `CHAVE_COPIADA — Chave copiada para área de transferência\nUsuário: ${usuarioLabel}`
      });
    } catch {
      /* ignore */
    }

    return { sucesso: true };
  }
}

module.exports = CentralEntradasService;
