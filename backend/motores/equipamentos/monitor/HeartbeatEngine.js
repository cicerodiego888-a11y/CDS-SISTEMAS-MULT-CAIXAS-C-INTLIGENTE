'use strict';

/**
 * HeartbeatEngine — RC3.1
 * Orquestra probe → status → health → eventos → sync com cadastro (Central).
 * Não altera Discovery / MIE / Central / EquipamentosService / DriverRegistry.
 */

const equipamentosService = require('../services/EquipamentosService');
const equipamentosRepository = require('../repositories/EquipamentosRepository');
const loggerService = require('../services/LoggerService');
const identidadeService = require('../identidade/IdentidadeService');
const hbRepo = require('./HeartbeatRepository');
const { obterPerfilHeartbeat } = require('./HeartbeatProfile');
const { executarProbe } = require('./HeartbeatProbe');
const { calcularHealthScoreHeartbeat } = require('./HeartbeatHealth');
const {
  HB_STATUS,
  EVENTOS,
  resolverStatusHeartbeat,
  mapearParaStatusEquipamento,
  ehStatusOnline
} = require('./HeartbeatStatus');
const alertChannel = require('./AlertChannel');

const BACKOFF_BASE_MS = Number(process.env.EQUIPAMENTOS_HB_BACKOFF_MS || 5000);
const BACKOFF_MAX_MS = Number(process.env.EQUIPAMENTOS_HB_BACKOFF_MAX_MS || 300000);
const STAGGER_MS = Number(process.env.EQUIPAMENTOS_HB_STAGGER_MS || 1500);

class HeartbeatEngine {
  constructor() {
    /** @type {Function|null} */
    this._probeFn = null;
  }

  /**
   * Injeta probe (testes).
   * @param {Function|null} fn
   */
  setProbeFn(fn) {
    this._probeFn = typeof fn === 'function' ? fn : null;
  }

  async garantirSchema() {
    return hbRepo.garantirSchema();
  }

  /**
   * Agenda heartbeats escalonados (nunca todos ao mesmo tempo).
   */
  async agendarTodosAtivos() {
    await this.garantirSchema();
    const lista = await equipamentosService.listar({});
    const agora = Date.now();
    let offset = 0;

    for (const eq of lista) {
      const perfil = obterPerfilHeartbeat(eq);
      const estado = await hbRepo.buscarPorEquipamento(eq.id);
      const base = estado?.proxima_verificacao
        ? new Date(estado.proxima_verificacao).getTime()
        : agora;
      const quando = Math.max(agora, base) + offset;
      await hbRepo.enfileirar(eq.id, new Date(quando).toISOString());
      await hbRepo.upsertEstado(eq.id, {
        intervalo_ms: perfil.intervalo_ms,
        timeout_ms: perfil.timeout_ms,
        tipo_teste: perfil.tipo_teste,
        proxima_verificacao: new Date(quando).toISOString(),
        status: estado?.status || HB_STATUS.SEM_COMUNICACAO
      });
      offset += STAGGER_MS;
    }

    return { agendados: lista.length };
  }

  /**
   * Processa no máximo 1 item da fila.
   */
  async processarProximo() {
    await this.garantirSchema();
    const agora = new Date().toISOString();
    const item = await hbRepo.obterProximoFila(agora);
    if (!item) return { processado: false };

    await hbRepo.marcarFila(item.id, 'processando', {
      tentativas: Number(item.tentativas || 0) + 1
    });

    try {
      const resultado = await this.executarParaEquipamento(item.equipamento_id);
      await hbRepo.marcarFila(item.id, 'concluido');

      const intervalo = Number(resultado.estado?.intervalo_ms || 30000);
      const falhas = Number(resultado.estado?.falhas_consecutivas || 0);
      const backoff = Math.min(
        BACKOFF_MAX_MS,
        BACKOFF_BASE_MS * (2 ** Math.max(0, falhas - 1))
      );
      const delay = resultado.sucesso ? intervalo : Math.max(intervalo, backoff);
      const proxima = new Date(Date.now() + delay).toISOString();

      await hbRepo.enfileirar(item.equipamento_id, proxima);
      await hbRepo.upsertEstado(item.equipamento_id, {
        proxima_verificacao: proxima,
        backoff_ate: resultado.sucesso ? null : proxima
      });

      return { processado: true, resultado };
    } catch (err) {
      await hbRepo.marcarFila(item.id, 'erro', { erro_mensagem: err.message });
      const retry = new Date(Date.now() + BACKOFF_BASE_MS).toISOString();
      await hbRepo.enfileirar(item.equipamento_id, retry);
      return { processado: true, erro: err.message };
    }
  }

  /**
   * Executa um ciclo de heartbeat para um equipamento.
   * @param {number|string} equipamentoId
   * @param {Object} [opcoes]
   */
  async executarParaEquipamento(equipamentoId, opcoes = {}) {
    await this.garantirSchema();
    const eq = await equipamentosService.buscarPorId(equipamentoId);

    if (!eq) {
      throw Object.assign(new Error('Equipamento não encontrado'), { statusCode: 404 });
    }

    const perfil = obterPerfilHeartbeat(eq);
    const anterior = (await hbRepo.buscarPorEquipamento(eq.id)) || {
      status: HB_STATUS.SEM_COMUNICACAO,
      falhas_consecutivas: 0,
      total_sucessos: 0,
      total_falhas: 0,
      historico_recente: [],
      tempo_online_ms: 0,
      tempo_offline_ms: 0
    };

    const probeFn = this._probeFn || executarProbe;
    const probe = opcoes.probeResult || await probeFn(eq, perfil);

    const agora = new Date();
    const agoraIso = agora.toISOString();
    const hist = [...(anterior.historico_recente || [])];
    hist.push(probe.sucesso ? 'ok' : 'fail');
    while (hist.length > 8) hist.shift();

    const falhasConsecutivas = probe.sucesso
      ? 0
      : Number(anterior.falhas_consecutivas || 0) + 1;

    const novoStatus = resolverStatusHeartbeat({
      sucesso: probe.sucesso,
      timeout: probe.timeout,
      falhasConsecutivas,
      historicoRecente: hist,
      statusAnterior: anterior.status
    });

    let tempoOnline = Number(anterior.tempo_online_ms || 0);
    let tempoOffline = Number(anterior.tempo_offline_ms || 0);
    let onlineDesde = anterior.online_desde || null;
    let offlineDesde = anterior.offline_desde || null;

    const eraOnline = ehStatusOnline(anterior.status);
    const ficaOnline = ehStatusOnline(novoStatus);

    if (anterior.atualizado_em) {
      const delta = Math.max(0, agora.getTime() - new Date(anterior.atualizado_em).getTime());
      if (eraOnline) tempoOnline += delta;
      else tempoOffline += delta;
    }

    if (ficaOnline && !eraOnline) {
      onlineDesde = agoraIso;
      offlineDesde = null;
    } else if (!ficaOnline && eraOnline) {
      offlineDesde = agoraIso;
      onlineDesde = null;
    }

    const mudancas = await hbRepo.contarMudancasRecentes(eq.id, 24);
    const health = calcularHealthScoreHeartbeat({
      status: novoStatus,
      latencia_ms: probe.latencia_ms,
      falhas_consecutivas: falhasConsecutivas,
      total_sucessos: Number(anterior.total_sucessos || 0) + (probe.sucesso ? 1 : 0),
      total_falhas: Number(anterior.total_falhas || 0) + (probe.sucesso ? 0 : 1),
      mudancas_frequentes: mudancas
    });

    const estado = await hbRepo.upsertEstado(eq.id, {
      status: novoStatus,
      latencia_ms: probe.latencia_ms,
      falhas_consecutivas: falhasConsecutivas,
      total_sucessos: Number(anterior.total_sucessos || 0) + (probe.sucesso ? 1 : 0),
      total_falhas: Number(anterior.total_falhas || 0) + (probe.sucesso ? 0 : 1),
      historico_recente: hist,
      ultima_comunicacao: probe.sucesso ? agoraIso : anterior.ultima_comunicacao,
      online_desde: onlineDesde,
      offline_desde: offlineDesde,
      tempo_online_ms: tempoOnline,
      tempo_offline_ms: tempoOffline,
      intervalo_ms: perfil.intervalo_ms,
      timeout_ms: perfil.timeout_ms,
      tipo_teste: perfil.tipo_teste,
      ultimo_ip: eq.ip || anterior.ultimo_ip,
      ultimo_firmware: eq.firmware || anterior.ultimo_firmware,
      ultima_porta: eq.porta_tcp != null ? String(eq.porta_tcp) : (eq.porta_com || anterior.ultima_porta),
      mudancas_24h: mudancas,
      health_score: health.score,
      health_rotulo: health.rotulo,
      atualizado_em: agoraIso
    });

    // Alimenta campos já lidos pela Central (sem alterar Central).
    try {
      await equipamentosRepository.atualizarComunicacao(eq.id, {
        status: mapearParaStatusEquipamento(novoStatus),
        ultimoErro: probe.sucesso ? null : (probe.erro || novoStatus)
      });
    } catch (_) { /* ignore */ }

    await this._emitirTransicoes(eq, anterior, estado, probe);
    await this._detectarMudancasIdentidade(eq, anterior, estado);

    await loggerService.logOperacao(eq.id, 'heartbeat', {
      status: novoStatus,
      latencia_ms: probe.latencia_ms,
      sucesso: !!probe.sucesso,
      timeout: !!probe.timeout,
      health_score: health.score
    }).catch(() => {});

    return {
      sucesso: !!probe.sucesso,
      probe,
      estado,
      health,
      status_anterior: anterior.status,
      status_novo: novoStatus
    };
  }

  async _emitirTransicoes(eq, anterior, estado, probe) {
    const ant = anterior.status;
    const novo = estado.status;

    if (ant !== novo) {
      await hbRepo.registrarEvento(eq.id, EVENTOS.STATUS_ALTERADO, {
        de: ant,
        para: novo,
        latencia_ms: probe.latencia_ms
      });
      await alertChannel.emitir({
        tipo: EVENTOS.STATUS_ALTERADO,
        equipamento_id: eq.id,
        de: ant,
        para: novo
      });
    }

    const eraOnline = ehStatusOnline(ant);
    const ficaOnline = ehStatusOnline(novo);

    if (!eraOnline && ficaOnline) {
      await hbRepo.registrarEvento(eq.id, EVENTOS.VOLTOU, { de: ant, para: novo });
      await alertChannel.emitir({ tipo: EVENTOS.VOLTOU, equipamento_id: eq.id });
    }

    if (eraOnline && !ficaOnline) {
      await hbRepo.registrarEvento(eq.id, EVENTOS.CAIU, { de: ant, para: novo });
      await alertChannel.emitir({ tipo: EVENTOS.CAIU, equipamento_id: eq.id });
    }

    if (novo === HB_STATUS.SEM_COMUNICACAO && ant !== HB_STATUS.SEM_COMUNICACAO) {
      await hbRepo.registrarEvento(eq.id, EVENTOS.PERDA_COMUNICACAO, {
        falhas: estado.falhas_consecutivas
      });
      await alertChannel.emitir({ tipo: EVENTOS.PERDA_COMUNICACAO, equipamento_id: eq.id });
    }

    if (probe.sucesso) {
      await hbRepo.registrarEvento(eq.id, EVENTOS.HEARTBEAT_OK, {
        latencia_ms: probe.latencia_ms
      });
    } else {
      await hbRepo.registrarEvento(eq.id, EVENTOS.HEARTBEAT_FALHA, {
        erro: probe.erro,
        timeout: !!probe.timeout
      });
    }
  }

  async _detectarMudancasIdentidade(eq, anterior, estado) {
    try {
      // Consome MIE (somente leitura).
      const identidades = await identidadeService.listar(50);
      const match = (identidades || []).find((idn) => {
        if (eq.ip && idn.ip_atual && String(idn.ip_atual) === String(eq.ip)) return true;
        if (eq.porta_com && idn.porta_com_atual && String(idn.porta_com_atual) === String(eq.porta_com)) return true;
        return false;
      });

      if (match) {
        if (anterior.ultimo_ip && match.ip_atual && String(anterior.ultimo_ip) !== String(match.ip_atual)) {
          await hbRepo.registrarEvento(eq.id, EVENTOS.MUDOU_IP, {
            de: anterior.ultimo_ip,
            para: match.ip_atual
          });
        }
        if (anterior.ultimo_firmware && match.firmware
          && String(anterior.ultimo_firmware) !== String(match.firmware)) {
          await hbRepo.registrarEvento(eq.id, EVENTOS.MUDOU_FIRMWARE, {
            de: anterior.ultimo_firmware,
            para: match.firmware
          });
        }
        if (anterior.ultima_porta && match.porta_atual != null
          && String(anterior.ultima_porta) !== String(match.porta_atual)) {
          await hbRepo.registrarEvento(eq.id, EVENTOS.MUDOU_PORTA, {
            de: anterior.ultima_porta,
            para: match.porta_atual
          });
        }
      }

      // Cadastro local: mudança de IP/porta no próprio registro vs último HB
      if (anterior.ultimo_ip && eq.ip && String(anterior.ultimo_ip) !== String(eq.ip)) {
        await hbRepo.registrarEvento(eq.id, EVENTOS.MUDOU_IP, {
          de: anterior.ultimo_ip,
          para: eq.ip,
          origem: 'cadastro'
        });
      }
      const portaAtual = eq.porta_tcp != null ? String(eq.porta_tcp) : (eq.porta_com || null);
      if (anterior.ultima_porta && portaAtual && String(anterior.ultima_porta) !== String(portaAtual)) {
        await hbRepo.registrarEvento(eq.id, EVENTOS.MUDOU_PORTA, {
          de: anterior.ultima_porta,
          para: portaAtual,
          origem: 'cadastro'
        });
      }
    } catch (_) { /* MIE/cadastro opcional */ }

    return estado;
  }

  async obterDashboard() {
    await this.garantirSchema();
    return hbRepo.obterResumoDashboard();
  }

  async listarEstados() {
    await this.garantirSchema();
    return hbRepo.listarTodos();
  }

  async obterEstado(equipamentoId) {
    await this.garantirSchema();
    return hbRepo.buscarPorEquipamento(equipamentoId);
  }

  async obterEventos(equipamentoId, limite = 50) {
    await this.garantirSchema();
    return hbRepo.listarEventos(equipamentoId, limite);
  }

  async obterSaude(equipamentoId) {
    const estado = await this.obterEstado(equipamentoId);
    if (!estado) {
      return { score: 0, rotulo: 'Equipamento indisponível.', fatores: ['sem_heartbeat'] };
    }
    return calcularHealthScoreHeartbeat({
      status: estado.status,
      latencia_ms: estado.latencia_ms,
      falhas_consecutivas: estado.falhas_consecutivas,
      total_sucessos: estado.total_sucessos,
      total_falhas: estado.total_falhas,
      mudancas_frequentes: estado.mudancas_24h
    });
  }
}

const heartbeatEngine = new HeartbeatEngine();

module.exports = heartbeatEngine;
module.exports.HeartbeatEngine = HeartbeatEngine;
