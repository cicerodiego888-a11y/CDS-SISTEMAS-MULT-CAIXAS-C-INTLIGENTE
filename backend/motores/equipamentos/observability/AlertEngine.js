/**
 * Sprint 15.8 — AlertEngine
 */

'use strict';

const repo = require('./ObservabilityRepository');
const eventStream = require('./EventStream');
const telemetry = require('./TelemetryCollector');

const LIMITES_PADRAO = Object.freeze({
  latenciaMs: 1500,
  reconexoesJanela: 5,
  syncFalhasConsecutivas: 3,
  heartbeatPerdidoMs: 120000,
  filaAcumulada: 20
});

const CODIGOS = Object.freeze({
  OFFLINE: 'EQUIPAMENTO_OFFLINE',
  LATENCIA: 'LATENCIA_ALTA',
  HEARTBEAT: 'HEARTBEAT_PERDIDO',
  RECONEXOES: 'RECONEXOES_EXCESSIVAS',
  SYNC_FALHA: 'SYNC_FALHAS_CONSECUTIVAS',
  FIRMWARE: 'FIRMWARE_INCOMPATIVEL',
  DRIVER: 'DRIVER_DESATUALIZADO',
  FILA: 'FILA_ACUMULADA'
});

class AlertEngine {
  constructor() {
    this._limites = { ...LIMITES_PADRAO };
    this._syncFalhas = new Map();
    this._ultimaLatencia = new Map();
    this._mem = [];
  }

  configurar(limites = {}) {
    Object.assign(this._limites, limites);
  }

  async emitir(alerta) {
    const item = {
      codigo: alerta.codigo,
      severidade: alerta.severidade || 'warning',
      titulo: alerta.titulo || alerta.codigo,
      mensagem: alerta.mensagem || '',
      equipamentoId: alerta.equipamentoId ?? null,
      driverId: alerta.driverId || null,
      detalhes: alerta.detalhes || {},
      abertoEm: new Date().toISOString()
    };

    try {
      item.id = await repo.upsertAlerta(item);
    } catch {
      item.id = `mem_${Date.now()}`;
    }

    this._mem.unshift(item);
    if (this._mem.length > 200) this._mem.length = 200;

    await eventStream.push({
      tipo: 'alert',
      severidade: item.severidade,
      equipamentoId: item.equipamentoId,
      driverId: item.driverId,
      mensagem: item.mensagem,
      payload: item
    });

    return item;
  }

  /**
   * Avalia snapshot operacional e gera alertas.
   * @param {Object} ctx
   */
  async avaliar(ctx = {}) {
    const gerados = [];
    const lim = this._limites;

    if (ctx.online === false) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.OFFLINE,
        severidade: 'critical',
        titulo: 'Equipamento offline',
        mensagem: `Equipamento ${ctx.equipamentoId || ctx.host || '?'} offline`,
        equipamentoId: ctx.equipamentoId,
        driverId: ctx.driverId
      }));
    }

    if (ctx.latenciaMs != null && Number(ctx.latenciaMs) > lim.latenciaMs) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.LATENCIA,
        severidade: 'warning',
        titulo: 'Latência acima do limite',
        mensagem: `Latência ${ctx.latenciaMs}ms > ${lim.latenciaMs}ms`,
        equipamentoId: ctx.equipamentoId,
        driverId: ctx.driverId,
        detalhes: { latenciaMs: ctx.latenciaMs, limite: lim.latenciaMs }
      }));
    }

    if (ctx.heartbeatPerdido === true) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.HEARTBEAT,
        severidade: 'critical',
        titulo: 'Heartbeat perdido',
        mensagem: 'Sem heartbeat no intervalo esperado',
        equipamentoId: ctx.equipamentoId,
        driverId: ctx.driverId
      }));
    }

    if (ctx.reconexoes != null && Number(ctx.reconexoes) >= lim.reconexoesJanela) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.RECONEXOES,
        severidade: 'warning',
        titulo: 'Excesso de reconexões',
        mensagem: `${ctx.reconexoes} reconexões na janela`,
        equipamentoId: ctx.equipamentoId,
        driverId: ctx.driverId
      }));
    }

    if (ctx.syncOk === false) {
      const key = String(ctx.equipamentoId || ctx.driverId || 'global');
      const n = (this._syncFalhas.get(key) || 0) + 1;
      this._syncFalhas.set(key, n);
      if (n >= lim.syncFalhasConsecutivas) {
        gerados.push(await this.emitir({
          codigo: CODIGOS.SYNC_FALHA,
          severidade: 'critical',
          titulo: 'Sincronizações consecutivas com falha',
          mensagem: `${n} falhas consecutivas de sync`,
          equipamentoId: ctx.equipamentoId,
          driverId: ctx.driverId,
          detalhes: { falhas: n }
        }));
      }
    } else if (ctx.syncOk === true) {
      this._syncFalhas.delete(String(ctx.equipamentoId || ctx.driverId || 'global'));
    }

    if (ctx.firmwareIncompativel === true) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.FIRMWARE,
        severidade: 'critical',
        titulo: 'Firmware incompatível',
        mensagem: ctx.firmwareMensagem || 'Firmware fora da lista homologada',
        equipamentoId: ctx.equipamentoId,
        driverId: ctx.driverId
      }));
    }

    if (ctx.driverDesatualizado === true) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.DRIVER,
        severidade: 'warning',
        titulo: 'Driver desatualizado',
        mensagem: ctx.driverMensagem || 'Versão do driver abaixo da recomendada',
        driverId: ctx.driverId
      }));
    }

    if (ctx.filaPendentes != null && Number(ctx.filaPendentes) >= lim.filaAcumulada) {
      gerados.push(await this.emitir({
        codigo: CODIGOS.FILA,
        severidade: 'warning',
        titulo: 'Fila acumulada',
        mensagem: `${ctx.filaPendentes} jobs pendentes`,
        detalhes: { fila: ctx.filaPendentes }
      }));
    }

    return gerados;
  }

  /**
   * Avalia contadores globais de telemetria.
   */
  async avaliarTelemetria() {
    const c = telemetry.contadores();
    const gerados = [];
    if (c.reconexoes >= this._limites.reconexoesJanela) {
      gerados.push(...await this.avaliar({ reconexoes: c.reconexoes }));
    }
    return gerados;
  }

  async listar({ ativos = true, limite = 100 } = {}) {
    try {
      const rows = await repo.listarAlertas({ ativos, limite });
      return rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        severidade: r.severidade,
        titulo: r.titulo,
        mensagem: r.mensagem,
        equipamentoId: r.equipamento_id,
        driverId: r.driver_id,
        ativo: r.ativo === 1,
        abertoEm: r.aberto_em,
        resolvidoEm: r.resolvido_em,
        detalhes: r.detalhes ? JSON.parse(r.detalhes) : {}
      }));
    } catch {
      return this._mem.slice(0, limite);
    }
  }
}

const alertEngine = new AlertEngine();

module.exports = alertEngine;
module.exports.AlertEngine = AlertEngine;
module.exports.CODIGOS = CODIGOS;
module.exports.LIMITES_PADRAO = LIMITES_PADRAO;
