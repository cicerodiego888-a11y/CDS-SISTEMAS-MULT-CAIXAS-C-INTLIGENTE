/**
 * CentralSyncBackgroundService — Sincronização automática em background.
 *
 * RC1: delega ao CentralEntradasOrchestrator.
 * RC7.3.1: logs operacionais + garantia de reagendamento após erro.
 *
 * @class CentralSyncBackgroundService
 */

const centralEntradasFlags = require('../config/centralEntradasFlags');
const CentralConfiguracaoService = require('./CentralConfiguracaoService');
const { ORIGENS } = require('../config/centralEventosTipos');
const { logCentral, logCentralErro } = require('../utils/centralLog');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');

function obterOrchestrator() {
  return require('../CentralEntradasOrchestrator');
}

function obterXmlWaitScheduler() {
  return require('./CentralXmlWaitScheduler');
}

function criarRequestId() {
  return `bg-req-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
}

class CentralSyncBackgroundService {
  constructor(deps = {}) {
    /** @private — provider oficial RC5 */
    this._config = deps.configuracaoService
      ?? deps.configService
      ?? new CentralConfiguracaoService();
    /** @private */
    this._orchestrator = deps.orchestrator ?? null;
    /** @private */
    this._flags = deps.flags ?? centralEntradasFlags;
    /** @private */
    this._xmlWait = deps.xmlWaitScheduler ?? null;
    /** @private */
    this._timeoutId = null;
    /** @private */
    this._ativo = false;
    /** @private */
    this._cicloEmExecucao = false;
  }

  /** @private */
  _xmlWaitScheduler() {
    return this._xmlWait ?? obterXmlWaitScheduler();
  }

  /** @private */
  _orch() {
    return this._orchestrator ?? obterOrchestrator();
  }

  /**
   * @private
   * @param {string} evento
   * @param {Object} [fields]
   */
  _log(evento, fields = {}) {
    logCentral('BACKGROUND', {
      Evento: evento,
      CorrelationId: fields.correlationId || null,
      RequestId: fields.requestId || null,
      Tempo: fields.tempoMs != null ? fields.tempoMs : null,
      Motivo: fields.motivo || null,
      ProximaExecucao: fields.proximaExecucao || null,
      IntervaloMs: fields.intervaloMs != null ? fields.intervaloMs : null,
      Resultado: fields.resultado || null,
      NotasNovas: fields.notasNovas != null ? fields.notasNovas : null
    });
  }

  estaAtivo() {
    return this._ativo;
  }

  async iniciar() {
    const correlationId = criarCorrelationId();
    const requestId = criarRequestId();
    const inicio = Date.now();

    await this._config.hidratarFlags();
    this.parar({
      correlationId,
      requestId,
      motivo: 'reinicio_antes_de_iniciar',
      silencioso: true
    });

    if (!this._flags.estaHabilitado()) {
      this._ativo = false;
      this._log('BACKGROUND SLEEP', {
        correlationId,
        requestId,
        tempoMs: Date.now() - inicio,
        motivo: 'modulo_central_desabilitado'
      });
      return;
    }

    // RC7.4 — XML Wait roda mesmo com sync automática desligada.
    try {
      await this._xmlWaitScheduler().iniciar();
    } catch (error) {
      logCentralErro('BACKGROUND', error, {
        Evento: 'BACKGROUND ERROR',
        CorrelationId: correlationId,
        RequestId: requestId,
        Motivo: 'falha_iniciar_xml_wait'
      });
    }

    // RC3.7.5 — Motor de recuperação automática de XML (consChNFe).
    try {
      const { obterMotorRecuperacaoXml } = require('../recuperacao-xml');
      await obterMotorRecuperacaoXml().iniciar({ delayMs: 20 * 1000 });
    } catch (error) {
      logCentralErro('BACKGROUND', error, {
        Evento: 'BACKGROUND ERROR',
        CorrelationId: correlationId,
        RequestId: requestId,
        Motivo: 'falha_iniciar_recuperacao_xml'
      });
    }

    if (!this._flags.syncAutomaticaHabilitada()) {
      this._ativo = false;
      this._log('BACKGROUND SLEEP', {
        correlationId,
        requestId,
        tempoMs: Date.now() - inicio,
        motivo: 'sync_automatica_desabilitada_xml_wait_ativo'
      });
      return;
    }

    this._ativo = true;
    this._log('BACKGROUND START', {
      correlationId,
      requestId,
      tempoMs: Date.now() - inicio,
      motivo: 'sync_automatica_habilitada'
    });
    this._agendarCiclo(3000, {
      correlationId,
      requestId,
      motivo: 'primeira_execucao'
    });
  }

  parar(opcoes = {}) {
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const requestId = opcoes.requestId || criarRequestId();
    const tinhaTimer = Boolean(this._timeoutId);
    const estavaAtivo = this._ativo;
    const pararXmlWait = opcoes.pararXmlWait !== false;

    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    this._ativo = false;
    this._cicloEmExecucao = false;

    if (pararXmlWait) {
      try {
        this._xmlWaitScheduler().parar({
          correlationId,
          motivo: opcoes.motivo || 'background_stop'
        });
      } catch { /* ignore */ }
    }

    try {
      const { obterMotorRecuperacaoXml } = require('../recuperacao-xml');
      obterMotorRecuperacaoXml().parar({ silencioso: true });
    } catch { /* ignore */ }

    try {
      this._orch().definirProximaExecucaoSync(null);
    } catch (error) {
      logCentralErro('BACKGROUND', error, {
        Evento: 'BACKGROUND ERROR',
        CorrelationId: correlationId,
        RequestId: requestId,
        Motivo: 'falha_ao_limpar_proxima_execucao'
      });
    }

    if (!opcoes.silencioso && (estavaAtivo || tinhaTimer)) {
      this._log('BACKGROUND STOP', {
        correlationId,
        requestId,
        motivo: opcoes.motivo || 'parada_explicita'
      });
    }
  }

  async reiniciar() {
    const correlationId = criarCorrelationId();
    const requestId = criarRequestId();
    this.parar({
      correlationId,
      requestId,
      motivo: 'reiniciar'
    });
    await this.iniciar();
  }

  /**
   * @private
   * @param {number} delayMs
   * @param {Object} [meta]
   */
  _agendarCiclo(delayMs, meta = {}) {
    if (this._timeoutId) clearTimeout(this._timeoutId);

    const correlationId = meta.correlationId || criarCorrelationId();
    const requestId = meta.requestId || criarRequestId();
    const delay = Math.max(0, Number(delayMs) || 0);
    const proximaExecucao = new Date(Date.now() + delay).toISOString();

    try {
      this._orch().definirProximaExecucaoSync(proximaExecucao);
    } catch { /* ignore */ }

    this._log('BACKGROUND TIMER', {
      correlationId,
      requestId,
      intervaloMs: delay,
      proximaExecucao,
      motivo: meta.motivo || 'agendamento'
    });
    this._log('BACKGROUND NEXT EXECUTION', {
      correlationId,
      requestId,
      intervaloMs: delay,
      proximaExecucao,
      motivo: meta.motivo || 'agendamento'
    });

    this._timeoutId = setTimeout(() => {
      this._executarCiclo({ correlationId, requestId }).catch((error) => {
        logCentralErro('BACKGROUND', error, {
          Evento: 'BACKGROUND ERROR',
          CorrelationId: correlationId,
          RequestId: requestId,
          Motivo: 'ciclo_nao_tratado'
        });
      });
    }, delay);
  }

  /**
   * @private
   * @param {Object} ids
   */
  async _executarCiclo(ids = {}) {
    const correlationId = ids.correlationId || criarCorrelationId();
    const requestId = ids.requestId || criarRequestId();
    const inicio = Date.now();

    if (!this._ativo) {
      this._log('BACKGROUND SLEEP', {
        correlationId,
        requestId,
        motivo: 'servico_inativo_no_wake'
      });
      return;
    }

    if (this._cicloEmExecucao) {
      this._log('BACKGROUND SLEEP', {
        correlationId,
        requestId,
        motivo: 'ciclo_anterior_ainda_em_execucao'
      });
      const intervaloFallback = await this._obterIntervaloSeguro();
      if (this._ativo) {
        this._agendarCiclo(intervaloFallback, {
          correlationId,
          requestId,
          motivo: 'reagendar_por_overlap'
        });
      }
      return;
    }

    if (!this._flags.syncAutomaticaHabilitada()) {
      this._log('BACKGROUND STOP', {
        correlationId,
        requestId,
        tempoMs: Date.now() - inicio,
        motivo: 'flag_desligada_durante_timer'
      });
      // Mantém XML Wait (RC7.4); encerra apenas o loop DistDFe periódico.
      this.parar({
        correlationId,
        requestId,
        motivo: 'flag_desligada_durante_timer',
        silencioso: true,
        pararXmlWait: false
      });
      return;
    }

    this._cicloEmExecucao = true;
    this._log('BACKGROUND WAKE', {
      correlationId,
      requestId,
      motivo: 'timer_disparado'
    });

    let intervalo = 15 * 60 * 1000;
    try {
      intervalo = await this._config.obterIntervaloMs();
      const proximaAposCiclo = new Date(Date.now() + intervalo).toISOString();
      this._orch().definirProximaExecucaoSync(proximaAposCiclo);

      this._log('BACKGROUND DISTDFE', {
        correlationId,
        requestId,
        motivo: 'inicio_sincronizacao_background',
        proximaExecucao: proximaAposCiclo,
        intervaloMs: intervalo
      });

      const resultado = await this._orch().executarSincronizacao({
        origem: ORIGENS.BACKGROUND,
        ignorarHorario: false,
        correlationId
      });

      this._log('BACKGROUND DISTDFE', {
        correlationId,
        requestId,
        tempoMs: Date.now() - inicio,
        motivo: 'fim_sincronizacao_background',
        resultado: resultado?.sucesso === false ? 'ERRO' : 'OK',
        notasNovas: resultado?.notasNovas
      });
    } catch (error) {
      logCentralErro('BACKGROUND', error, {
        Evento: 'BACKGROUND ERROR',
        CorrelationId: correlationId,
        RequestId: requestId,
        Tempo: Date.now() - inicio,
        Motivo: 'falha_execucao_ciclo'
      });
      intervalo = await this._obterIntervaloSeguro(intervalo);
    } finally {
      this._cicloEmExecucao = false;
      if (this._ativo && this._flags.syncAutomaticaHabilitada()) {
        this._agendarCiclo(intervalo, {
          correlationId: criarCorrelationId(),
          requestId: criarRequestId(),
          motivo: 'proximo_ciclo'
        });
      } else if (this._ativo) {
        this.parar({
          correlationId,
          requestId,
          motivo: 'flag_off_apos_ciclo',
          pararXmlWait: false
        });
      }
    }
  }

  /**
   * @private
   * @param {number} [fallback]
   * @returns {Promise<number>}
   */
  async _obterIntervaloSeguro(fallback = 15 * 60 * 1000) {
    try {
      return await this._config.obterIntervaloMs();
    } catch {
      return Math.max(60 * 1000, Number(fallback) || 15 * 60 * 1000);
    }
  }

  obterStatus() {
    const estado = this._orch().obterEstadoSyncExecucao();
    let xmlWait = null;
    try {
      xmlWait = this._xmlWaitScheduler().obterStatus();
    } catch { /* ignore */ }

    return {
      servicoAtivo: this._ativo || Boolean(xmlWait?.ativo),
      syncAutomaticaHabilitada: this._flags.syncAutomaticaHabilitada(),
      syncDistDfeAtivo: this._ativo,
      executando: estado.executando || this._cicloEmExecucao,
      ultimaExecucao: estado.ultimaExecucao,
      proximaExecucao: estado.proximaExecucao,
      ultimoResultado: estado.ultimoResultado
        ? {
          sucesso: estado.ultimoResultado.sucesso,
          notasNovas: estado.ultimoResultado.notasNovas,
          duracaoMs: estado.ultimoResultado.duracaoMs,
          mensagem: estado.ultimoResultado.mensagem
        }
        : null,
      xmlWait
    };
  }
}

module.exports = new CentralSyncBackgroundService();
module.exports.CentralSyncBackgroundService = CentralSyncBackgroundService;
