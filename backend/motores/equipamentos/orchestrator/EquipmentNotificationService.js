/**
 * Sprint 15.6 — EquipmentNotificationService
 */

'use strict';

const crypto = require('crypto');

const NOTIF_TIPOS = Object.freeze({
  OFFLINE: 'balanca_offline',
  SYNC_FALHOU: 'sincronizacao_falhou',
  ROLLBACK: 'rollback_executado',
  FIRMWARE: 'firmware_incompativel',
  DIVERGENCIA: 'divergencia_detectada',
  SYNC_OK: 'sincronizacao_ok',
  INFO: 'info'
});

class EquipmentNotificationService {
  constructor(deps = {}) {
    this._itens = [];
    this._limite = deps.limite || 200;
    this.agora = deps.agora || (() => new Date());
    this.onNotify = deps.onNotify || (() => {});
  }

  notify(tipo, dados = {}) {
    const item = {
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `n-${Date.now()}`,
      tipo: tipo || NOTIF_TIPOS.INFO,
      titulo: dados.titulo || tipo,
      mensagem: dados.mensagem || '',
      equipamentoId: dados.equipamentoId ?? null,
      host: dados.host || null,
      severidade: dados.severidade || this._severidade(tipo),
      data: this.agora().toISOString(),
      lida: false,
      detalhe: dados.detalhe || null
    };
    this._itens.unshift(item);
    if (this._itens.length > this._limite) this._itens.length = this._limite;
    this.onNotify(item);
    return item;
  }

  offline(alvo, mensagem) {
    return this.notify(NOTIF_TIPOS.OFFLINE, {
      titulo: 'Balança offline',
      mensagem: mensagem || `${alvo.nome || alvo.host} offline`,
      equipamentoId: alvo.equipamentoId,
      host: alvo.host,
      severidade: 'error'
    });
  }

  syncFalhou(alvo, erro) {
    return this.notify(NOTIF_TIPOS.SYNC_FALHOU, {
      titulo: 'Sincronização falhou',
      mensagem: erro?.message || String(erro || 'falha'),
      equipamentoId: alvo.equipamentoId,
      host: alvo.host,
      severidade: 'error'
    });
  }

  rollback(alvo, detalhe) {
    return this.notify(NOTIF_TIPOS.ROLLBACK, {
      titulo: 'Rollback executado',
      mensagem: `Rollback em ${alvo.nome || alvo.host}`,
      equipamentoId: alvo.equipamentoId,
      host: alvo.host,
      severidade: 'warning',
      detalhe
    });
  }

  firmware(alvo, mensagem) {
    return this.notify(NOTIF_TIPOS.FIRMWARE, {
      titulo: 'Firmware incompatível',
      mensagem: mensagem || 'Firmware incompatível',
      equipamentoId: alvo.equipamentoId,
      host: alvo.host,
      severidade: 'warning'
    });
  }

  divergencia(alvo, mensagem) {
    return this.notify(NOTIF_TIPOS.DIVERGENCIA, {
      titulo: 'Divergência detectada',
      mensagem: mensagem || 'Divergência de carga',
      equipamentoId: alvo.equipamentoId,
      host: alvo.host,
      severidade: 'warning'
    });
  }

  listar(limite = 50) {
    return this._itens.slice(0, limite).map((i) => ({ ...i }));
  }

  marcarLida(id) {
    const item = this._itens.find((i) => i.id === id);
    if (item) item.lida = true;
    return item ? { ...item } : null;
  }

  _severidade(tipo) {
    if (tipo === NOTIF_TIPOS.OFFLINE || tipo === NOTIF_TIPOS.SYNC_FALHOU) return 'error';
    if (tipo === NOTIF_TIPOS.ROLLBACK || tipo === NOTIF_TIPOS.FIRMWARE || tipo === NOTIF_TIPOS.DIVERGENCIA) {
      return 'warning';
    }
    return 'info';
  }

  clear() {
    this._itens = [];
  }
}

EquipmentNotificationService.NOTIF_TIPOS = NOTIF_TIPOS;

module.exports = EquipmentNotificationService;
