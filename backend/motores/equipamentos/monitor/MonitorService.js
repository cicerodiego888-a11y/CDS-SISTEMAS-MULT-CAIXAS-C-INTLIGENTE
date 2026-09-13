'use strict';

/**
 * MonitorService — RC3.1 Heartbeat inteligente
 *
 * Worker com fila + stagger + backoff.
 * Consome EquipamentosService / Transportes / MIE (leitura).
 * Não altera Discovery / MIE / Central / DriverRegistry / EquipamentosService.
 */

const loggerService = require('../services/LoggerService');
const heartbeatEngine = require('./HeartbeatEngine');
const hbRepo = require('./HeartbeatRepository');
const { HB_STATUS, HB_STATUS_ROTULO } = require('./HeartbeatStatus');
const equipamentosRepository = require('../repositories/EquipamentosRepository');

const CYCLE_MS = Number(process.env.EQUIPAMENTOS_MONITOR_INTERVAL_MS || 4000);
const ACTIVE_DEFAULT = process.env.EQUIPAMENTOS_MONITOR_ACTIVE !== '0';

class MonitorService {
  constructor() {
    /** @type {NodeJS.Timeout|null} */
    this._intervalId = null;

    /** @type {boolean} */
    this._ativo = false;

    /** @type {boolean} */
    this._cicloRodando = false;

    /** @type {number} */
    this._ciclos = 0;
  }

  /**
   * Inicia monitoramento periódico.
   * @param {Object} [opcoes]
   * @returns {void}
   */
  iniciar(opcoes = {}) {
    const ativo = opcoes.ativo !== undefined ? !!opcoes.ativo : ACTIVE_DEFAULT;
    if (!ativo) {
      this._ativo = false;
      return;
    }
    if (this._intervalId) {
      this._ativo = true;
      return;
    }

    this._ativo = true;
    const intervalo = opcoes.intervaloMs ?? CYCLE_MS;

    heartbeatEngine.garantirSchema()
      .then(() => heartbeatEngine.agendarTodosAtivos())
      .catch((err) => {
        loggerService.error('Falha ao iniciar heartbeat', {
          operacao: 'monitor.iniciar',
          detalhe: err.message
        }).catch(() => {});
      });

    this._intervalId = setInterval(() => {
      this._executarCiclo().catch((err) => {
        loggerService.error('Erro no ciclo de monitoramento', {
          operacao: 'monitor.ciclo',
          detalhe: err.message
        }).catch(() => {});
      });
    }, intervalo);

    this._executarCiclo().catch(() => {});
  }

  /**
   * Para monitoramento.
   * @returns {void}
   */
  parar() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._ativo = false;
    this._cicloRodando = false;
  }

  /**
   * Retorna se o monitor está ativo.
   * @returns {boolean}
   */
  estaAtivo() {
    return this._ativo;
  }

  /**
   * Snapshot atual de status (heartbeat + cadastro).
   * @returns {Promise<Object>}
   */
  async obterStatusGeral() {
    const dash = await heartbeatEngine.obterDashboard();
    const estados = await heartbeatEngine.listarEstados();
    return {
      ativo: this._ativo,
      ciclos: this._ciclos,
      dashboard: dash,
      equipamentos: estados,
      status_catalogo: HB_STATUS,
      status_rotulos: HB_STATUS_ROTULO
    };
  }

  /**
   * Snapshot das métricas de sincronização para dashboard/monitor.
   * @returns {Promise<Object>}
   */
  async obterMetricasSincronizacao() {
    try {
      const resumo = await equipamentosRepository.obterResumoSincronizacoes();
      return {
        fila: resumo.pendentes,
        pendentes: resumo.pendentes,
        concluidas: resumo.concluidas,
        erros: resumo.erros,
        ultima_sincronizacao: resumo.ultima_sincronizacao
      };
    } catch (err) {
      await loggerService.error('Falha ao obter métricas de sincronização', {
        operacao: 'monitor.metricas_sync',
        detalhe: err.message
      });
      return { fila: 0, pendentes: 0, concluidas: 0, erros: 0, ultima_sincronizacao: null };
    }
  }

  /**
   * Força verificação imediata.
   */
  async verificarAgora(equipamentoId) {
    return heartbeatEngine.executarParaEquipamento(equipamentoId);
  }

  /**
   * Ciclo interno — processa **um** heartbeat por vez.
   * @returns {Promise<void>}
   * @private
   */
  async _executarCiclo() {
    if (!this._ativo || this._cicloRodando) return;
    this._cicloRodando = true;
    this._ciclos += 1;
    try {
      await heartbeatEngine.processarProximo();
      if (this._ciclos % 50 === 0) {
        await hbRepo.limparFilaAntiga(7);
      }
      // Reagenda novos cadastros periodicamente
      if (this._ciclos % 25 === 0) {
        await heartbeatEngine.agendarTodosAtivos();
      }
    } finally {
      this._cicloRodando = false;
    }
  }
}

const monitorService = new MonitorService();

module.exports = monitorService;
module.exports.MonitorService = MonitorService;
