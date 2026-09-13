/**
 * HealthMonitor — fachada do Health Monitor (RC3.4.6).
 * Auto-recuperação apenas interna (Parser), jamais SEFAZ.
 *
 * @module motores/central-entradas/health/HealthMonitor
 */

const HealthAnalyzer = require('./HealthAnalyzer');
const HealthRepository = require('./HealthRepository');
const HealthNotifier = require('./HealthNotifier');
const { HealthNiveis, obterLabel, obterIndicador } = require('./HealthNiveis');

class HealthMonitor {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._repo = deps.repository || new HealthRepository(deps);
    this._analyzer = deps.analyzer || new HealthAnalyzer({
      repository: this._repo,
      obterMirx: deps.obterMirx,
      agora: deps.agora
    });
    this._notifier = deps.notifier || new HealthNotifier();
    this._obterOrchestrator = deps.obterOrchestrator
      || (() => require('../CentralEntradasOrchestrator'));
    this._ultimoScan = null;
    this._porDocumento = new Map();
  }

  /**
   * Executa varredura + persiste + auto-recuperação interna.
   * @param {Object} [opcoes]
   */
  async executarScan(opcoes = {}) {
    const anteriores = {};
    for (const [id, av] of this._porDocumento.entries()) {
      anteriores[id] = av;
    }

    const resumo = await this._analyzer.analisarTodos({
      ...opcoes,
      anteriores
    });

    this._porDocumento.clear();
    for (const av of resumo.documentos || []) {
      this._porDocumento.set(String(av.documentoId), av);
      if (
        av.nivel === HealthNiveis.ATENCAO
        || av.nivel === HealthNiveis.CRITICO
        || av.nivel === HealthNiveis.BLOQUEADO
        || av.nivel === HealthNiveis.RESOLVIDO
      ) {
        this._notifier.notificarDocumento(av, {
          id: av.documentoId,
          chave: av.chave
        });
      }
    }

    let auto = { executado: false, processados: 0 };
    if (opcoes.autoRecuperar !== false) {
      auto = await this._tentarAutoRecuperacao(resumo.alertas || []);
    }

    const painel = this._montarPainel(resumo, auto);
    this._ultimoScan = painel;
    this._notifier.notificarScan(resumo);

    await this._repo.salvarEstado({
      versao: 'RC3.4.6',
      painel,
      porDocumento: Object.fromEntries(this._porDocumento.entries())
    });

    return painel;
  }

  /**
   * @private — somente processar_pendentes (Parser/MIIP interno).
   */
  async _tentarAutoRecuperacao(alertas) {
    const elegiveis = alertas.filter(
      (a) => a.autoRecuperavel && a.acaoInterna === 'processar_pendentes'
    );
    if (!elegiveis.length) {
      return { executado: false, processados: 0, motivo: 'sem_candidatos' };
    }

    try {
      const orch = this._obterOrchestrator();
      if (typeof orch.processarDocumentosPendentes !== 'function') {
        return { executado: false, processados: 0, motivo: 'orchestrator_indisponivel' };
      }
      const ids = [...new Set(elegiveis.map((a) => a.documentoId))];
      const resultado = await orch.processarDocumentosPendentes({
        limite: Math.min(ids.length, 20),
        origemHealth: true
      });
      return {
        executado: true,
        processados: Array.isArray(resultado) ? resultado.length : 0,
        documentoIds: ids,
        sefazConsultada: false
      };
    } catch (error) {
      return {
        executado: false,
        processados: 0,
        erro: error.message,
        sefazConsultada: false
      };
    }
  }

  /** @private */
  _montarPainel(resumo, auto = {}) {
    return {
      versao: 'RC3.4.6',
      geradoEm: resumo.geradoEm,
      analisados: resumo.analisados,
      tempoScanMs: resumo.tempoScanMs,
      contadores: resumo.contadores,
      alertas: (resumo.alertas || []).map((a) => ({
        documentoId: a.documentoId,
        chave: a.chave,
        fornecedor: a.fornecedor,
        status: a.status,
        dataEmissao: a.dataEmissao || null,
        dataEncerramento: a.dataEncerramento || null,
        numero: a.numero != null ? a.numero : null,
        serie: a.serie != null ? a.serie : null,
        nivel: a.nivel,
        nivelLabel: a.nivelLabel,
        indicador: a.indicador,
        cor: a.cor,
        regra: a.regra,
        diagnostico: a.diagnostico,
        recomendacao: a.recomendacao,
        tempoParadoLabel: a.tempoParadoLabel,
        detectadoEm: a.detectadoEm
      })),
      estatisticas: resumo.estatisticas || {},
      autoRecuperacao: auto,
      sefazConsultada: false
    };
  }

  async obterPainel(opcoes = {}) {
    if (this._ultimoScan && opcoes.forcar !== true) {
      return this._ultimoScan;
    }
    const salvo = await this._repo.carregarEstado();
    if (salvo?.painel && opcoes.forcar !== true) {
      this._ultimoScan = salvo.painel;
      if (salvo.porDocumento) {
        this._porDocumento = new Map(Object.entries(salvo.porDocumento));
      }
      return this._ultimoScan;
    }
    return this.executarScan(opcoes);
  }

  obterDocumento(documentoId) {
    const id = String(documentoId);
    const cached = this._porDocumento.get(id);
    if (cached) return cached;
    return null;
  }

  async analisarDocumento(documentoId) {
    const docs = await this._repo.listarDocumentosParaAnalise(400);
    const doc = docs.find((d) => Number(d.id) === Number(documentoId));
    if (!doc) {
      return {
        documentoId: Number(documentoId),
        nivel: HealthNiveis.SAUDAVEL,
        nivelLabel: obterLabel(HealthNiveis.SAUDAVEL),
        ...obterIndicador(HealthNiveis.SAUDAVEL),
        diagnostico: 'Documento não encontrado na varredura ativa (pode estar finalizado).',
        recomendacao: 'Nenhuma ação necessária.',
        regra: null,
        detectadoEm: new Date().toISOString()
      };
    }
    const prev = this._porDocumento.get(String(doc.id));
    const av = this._analyzer.analisarUm(doc, null, prev);
    this._porDocumento.set(String(doc.id), av);
    return av;
  }

  listarAlertas(filtros = {}) {
    const painel = this._ultimoScan;
    let lista = painel?.alertas || [];
    if (filtros.nivel) {
      lista = lista.filter((a) => a.nivel === filtros.nivel);
    }
    return {
      total: lista.length,
      alertas: lista,
      contadores: painel?.contadores || null,
      geradoEm: painel?.geradoEm || null
    };
  }
}

module.exports = HealthMonitor;
