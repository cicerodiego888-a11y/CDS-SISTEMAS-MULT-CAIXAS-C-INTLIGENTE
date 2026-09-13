/**
 * CentralXmlWaitScheduler — RC3.4.1 fachada de classe sobre MIRX.
 *
 * API pública preservada (Background, Orchestrator, Upload, UI, testes).
 * Recuperação agressiva (forcarConsulta permanente) eliminada:
 * consultas passam pela fila/worker MIRX + Gate SEFAZ.
 *
 * @module motores/central-entradas/services/CentralXmlWaitScheduler
 */

const { MirxService } = require('../mirx/MirxService');
const {
  BACKOFF_MINUTOS,
  calcularBackoffMs
} = require('../mirx/MirxBackoff');
const {
  INTERVALO_BLOQUEIO_656_MS,
  COOLDOWN_656_MINUTOS,
  calcularCooldown656Ms
} = require('./CentralSefazOperationalGate');

class CentralXmlWaitScheduler {
  /**
   * @param {Object} [deps] — mesmos hooks do MIRX (repos, gate, orchestrator, agora, tickMs)
   */
  constructor(deps = {}) {
    this._mirx = deps.mirx || new MirxService(deps);
    /** @private — compat testes RC7.4 (lock lógico por documento) */
    this._locks = new Set();
  }

  /** @private compat testes */
  get _docs() {
    return this._mirx._docs;
  }

  get _ativo() {
    return this._mirx._ativo;
  }

  set _ativo(v) {
    this._mirx._ativo = Boolean(v);
  }

  obterGate() {
    return this._mirx.obterGate();
  }

  estaAtivo() {
    return this._mirx.estaAtivo();
  }

  static get BACKOFF_MINUTOS() {
    return BACKOFF_MINUTOS;
  }

  static get INTERVALO_BLOQUEIO_656_MS() {
    return INTERVALO_BLOQUEIO_656_MS;
  }

  async iniciar() {
    return this._mirx.iniciar();
  }

  parar(opcoes = {}) {
    return this._mirx.parar(opcoes);
  }

  async reiniciar() {
    return this._mirx.reiniciar();
  }

  async recuperarPendentes(opcoes = {}) {
    return this._mirx.recuperarPendentes(opcoes);
  }

  cancelar(documentoId, motivo = 'stop') {
    const id = Number(documentoId);
    this._locks.delete(id);
    if (motivo === 'upload') {
      this._mirx._metricas.canceladosUpload = (this._mirx._metricas.canceladosUpload || 0) + 1;
      try {
        this._mirx.limparBloqueio656('upload');
        this._mirx.limparErro593('upload');
      } catch { /* ignore */ }
    }
    return this._mirx.cancelar(documentoId, motivo);
  }

  cancelarPorChave(chave, motivo = 'upload') {
    return this._mirx.cancelarPorChave(chave, motivo);
  }

  obterEstadoDocumento(documentoId) {
    return this._mirx.obterEstadoDocumento(documentoId);
  }

  obterTelemetria() {
    const t = this._mirx.obterTelemetria();
    return {
      ...t,
      canceladosUpload: this._mirx._metricas.canceladosUpload || 0,
      canceladosOutros: this._mirx._metricas.canceladosOutros || 0
    };
  }

  obterStatus() {
    return this._mirx.obterStatus();
  }

  obterBloqueio656() {
    return this._mirx.obterBloqueio656();
  }

  estaBloqueadoDistDfe() {
    return this._mirx.estaBloqueadoDistDfe();
  }

  registrarBloqueio656(dados = {}) {
    return this._mirx.registrarBloqueio656(dados);
  }

  limparBloqueio656(motivo = 'limpeza') {
    return this._mirx.limparBloqueio656(motivo);
  }

  limparErro593(motivo = 'limpeza') {
    return this._mirx.limparErro593(motivo);
  }

  registrarConsultaEvitada656(ctx = {}) {
    return this._mirx.registrarConsultaEvitada656(ctx);
  }

  /**
   * Enfileira recuperação (API preferida RC3.4.1).
   */
  async enfileirarRecuperacao(doc, meta = {}) {
    return this._mirx.enfileirar(doc, meta);
  }

  /**
   * RC3.4.2 — solicitação manual (botão Solicitar XML Completo).
   */
  async solicitarXmlManual(documentoId, opcoes = {}) {
    return this._mirx.solicitarXmlManual(documentoId, opcoes);
  }

  async entrarSleep(documentoId, meta = {}) {
    return this._mirx.entrarSleep(documentoId, meta);
  }

  async despertar(documentoId, meta = {}) {
    return this._mirx.despertar(documentoId, meta);
  }

  /**
   * @private Compat testes — processa um documento via worker MIRX.
   */
  async _processarDocumento(estado, correlationId) {
    const id = estado?.documentoId;
    if (!id || this._locks.has(id)) return { ignorado: true };
    this._locks.add(id);
    try {
      return await this._mirx._worker.processar({
        documentoId: id,
        correlationId: correlationId || estado.correlationId,
        origem: 'teste',
        motivo: 'processar_documento_compat'
      });
    } finally {
      this._locks.delete(id);
    }
  }

  /**
   * @private Compat testes
   */
  async _executarTick() {
    return this._mirx._executarTick();
  }
}

const instancia = new CentralXmlWaitScheduler({
  mirx: require('../mirx')
});

try {
  require('./CentralSefazOperationalGate').vincularPersistencia(() => {
    instancia._mirx._persistirEstado().catch(() => {});
  });
} catch { /* ignore */ }

module.exports = instancia;
module.exports.CentralXmlWaitScheduler = CentralXmlWaitScheduler;
module.exports.BACKOFF_MINUTOS = BACKOFF_MINUTOS;
module.exports.INTERVALO_BLOQUEIO_656_MS = INTERVALO_BLOQUEIO_656_MS;
module.exports.COOLDOWN_656_MINUTOS = COOLDOWN_656_MINUTOS;
module.exports.calcularCooldown656Ms = calcularCooldown656Ms;
module.exports.CHAVE_ESTADO = MirxService.CHAVE_ESTADO;
module.exports.calcularBackoffMs = calcularBackoffMs;
