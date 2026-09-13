/**
 * Sprint 15.6 — EquipmentHealthService
 * Heartbeat, latência, reconexões, última sync, firmware, estado.
 */

'use strict';

const HEALTH_STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  SINCRONIZANDO: 'SINCRONIZANDO',
  ERRO: 'ERRO',
  DESCONHECIDO: 'DESCONHECIDO'
});

class EquipmentHealthService {
  constructor(deps = {}) {
    /** @type {Map<string, Object>} */
    this._health = new Map();
    this.agora = deps.agora || (() => new Date());
    this.offlineAposMs = deps.offlineAposMs || 60000;
  }

  _key(alvo = {}) {
    if (alvo.equipamentoId != null) return `id:${alvo.equipamentoId}`;
    if (alvo.equipamento_id != null) return `id:${alvo.equipamento_id}`;
    return `host:${alvo.host || ''}:${alvo.porta != null ? alvo.porta : 9000}`;
  }

  upsert(alvo, patch = {}) {
    const key = this._key(alvo);
    const prev = this._health.get(key) || {
      key,
      equipamentoId: alvo.equipamentoId ?? alvo.equipamento_id ?? null,
      nome: alvo.nome || null,
      host: alvo.host || alvo.ip || null,
      porta: alvo.porta != null ? Number(alvo.porta) : 9000,
      status: HEALTH_STATUS.DESCONHECIDO,
      heartbeatEm: null,
      tempoRespostaMs: null,
      reconexoes: 0,
      ultimaSync: null,
      versaoCarga: null,
      firmware: alvo.firmware || null,
      estado: HEALTH_STATUS.DESCONHECIDO,
      filaPendentes: 0,
      ultimoErro: null,
      atualizadoEm: null
    };
    const next = {
      ...prev,
      ...patch,
      key,
      equipamentoId: patch.equipamentoId ?? prev.equipamentoId,
      nome: patch.nome ?? prev.nome ?? alvo.nome,
      host: patch.host ?? prev.host ?? alvo.host,
      porta: patch.porta ?? prev.porta ?? alvo.porta,
      firmware: patch.firmware ?? prev.firmware ?? alvo.firmware,
      atualizadoEm: this.agora().toISOString()
    };
    if (patch.status) next.estado = patch.status;
    this._health.set(key, next);
    return { ...next };
  }

  registrarHeartbeat(alvo, { tempoRespostaMs, firmware, ok = true } = {}) {
    const key = this._key(alvo);
    const prev = this._health.get(key);
    return this.upsert(alvo, {
      status: ok ? HEALTH_STATUS.ONLINE : HEALTH_STATUS.OFFLINE,
      heartbeatEm: this.agora().toISOString(),
      tempoRespostaMs: tempoRespostaMs != null ? Number(tempoRespostaMs) : null,
      firmware: firmware || prev?.firmware || alvo.firmware,
      reconexoes: ok ? (prev?.reconexoes || 0) : (prev?.reconexoes || 0) + 1,
      ultimoErro: ok ? null : (prev?.ultimoErro || 'heartbeat falhou')
    });
  }

  registrarSync(alvo, { ok, versao, erro } = {}) {
    return this.upsert(alvo, {
      ultimaSync: this.agora().toISOString(),
      versaoCarga: versao != null ? versao : undefined,
      status: ok === false ? HEALTH_STATUS.ERRO : HEALTH_STATUS.ONLINE,
      ultimoErro: ok === false ? (erro || 'sync falhou') : null
    });
  }

  marcarSincronizando(alvo) {
    return this.upsert(alvo, { status: HEALTH_STATUS.SINCRONIZANDO });
  }

  obter(alvoOuKey) {
    if (typeof alvoOuKey === 'string') {
      const h = this._health.get(alvoOuKey);
      return h ? this._avaliarOffline({ ...h }) : null;
    }
    const h = this._health.get(this._key(alvoOuKey));
    return h ? this._avaliarOffline({ ...h }) : null;
  }

  listar() {
    return [...this._health.values()].map((h) => this._avaliarOffline({ ...h }));
  }

  _avaliarOffline(h) {
    if (h.status === HEALTH_STATUS.SINCRONIZANDO) return h;
    if (h.heartbeatEm) {
      const idade = this.agora().getTime() - new Date(h.heartbeatEm).getTime();
      if (idade > this.offlineAposMs && h.status === HEALTH_STATUS.ONLINE) {
        return { ...h, status: HEALTH_STATUS.OFFLINE, estado: HEALTH_STATUS.OFFLINE };
      }
    }
    return h;
  }

  resumo() {
    const lista = this.listar();
    const cont = { total: lista.length, online: 0, offline: 0, sincronizando: 0, erro: 0 };
    for (const h of lista) {
      if (h.status === HEALTH_STATUS.ONLINE) cont.online += 1;
      else if (h.status === HEALTH_STATUS.OFFLINE) cont.offline += 1;
      else if (h.status === HEALTH_STATUS.SINCRONIZANDO) cont.sincronizando += 1;
      else if (h.status === HEALTH_STATUS.ERRO) cont.erro += 1;
    }
    return cont;
  }

  clear() {
    this._health.clear();
  }
}

EquipmentHealthService.HEALTH_STATUS = HEALTH_STATUS;

module.exports = EquipmentHealthService;
