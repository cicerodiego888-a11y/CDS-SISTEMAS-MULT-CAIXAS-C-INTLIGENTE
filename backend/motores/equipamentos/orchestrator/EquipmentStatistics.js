/**
 * Sprint 15.6 — EquipmentStatistics
 */

'use strict';

class EquipmentStatistics {
  constructor(deps = {}) {
    this.health = deps.health;
    this.queue = deps.queue;
    this.notifications = deps.notifications;
    this._syncDuracoes = [];
    this._syncTotal = 0;
    this._syncOk = 0;
    this._syncErro = 0;
  }

  registrarDuracao(ms, ok = true) {
    if (ms != null && Number.isFinite(Number(ms))) {
      this._syncDuracoes.push(Number(ms));
      if (this._syncDuracoes.length > 200) this._syncDuracoes.shift();
    }
    this._syncTotal += 1;
    if (ok) this._syncOk += 1;
    else this._syncErro += 1;
  }

  tempoMedioMs() {
    if (!this._syncDuracoes.length) return null;
    const soma = this._syncDuracoes.reduce((a, b) => a + b, 0);
    return Math.round(soma / this._syncDuracoes.length);
  }

  snapshot() {
    const health = this.health?.resumo?.() || { total: 0, online: 0, offline: 0, sincronizando: 0, erro: 0 };
    const fila = this.queue?.snapshot?.() || { pendentes: 0, executando: 0 };
    const notifs = this.notifications?.listar?.(10) || [];

    return {
      balancas: health.total,
      online: health.online,
      offline: health.offline,
      sincronizando: health.sincronizando,
      erro: health.erro,
      filaPendentes: fila.pendentes,
      filaExecutando: fila.executando,
      tempoMedioSyncMs: this.tempoMedioMs(),
      syncTotal: this._syncTotal,
      syncOk: this._syncOk,
      syncErro: this._syncErro,
      notificacoesRecentes: notifs.length,
      ultimaNotificacao: notifs[0] || null
    };
  }
}

module.exports = EquipmentStatistics;
