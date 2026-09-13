/**
 * RC14.14.7 — Registry único de EquipmentSession
 * Uma instância por host:porta (alias equipamentoId). Sem clones descartáveis.
 */

'use strict';

const { EquipmentSession } = require('./EquipmentSession');

function chaveHostPorta(host, porta) {
  if (host == null || porta == null || porta === '') return null;
  return `hp:${String(host).trim()}:${Number(porta)}`;
}

function chaveEquipamento(id) {
  if (id == null || id === '') return null;
  return `eq:${Number(id)}`;
}

class EquipmentSessionRegistry {
  constructor() {
    /** @type {Map<string, import('./EquipmentSession').EquipmentSession>} */
    this._byKey = new Map();
    /** @type {Map<string, string>} */
    this._aliases = new Map();
  }

  _resolverPrimary(alvo = {}) {
    const eq = chaveEquipamento(alvo.equipamentoId ?? alvo.equipamento_id ?? alvo.id);
    if (eq && this._aliases.has(eq)) return this._aliases.get(eq);
    if (eq && this._byKey.has(eq)) return eq;
    const hp = chaveHostPorta(alvo.host || alvo.ip, alvo.porta ?? alvo.porta_tcp);
    if (hp && this._byKey.has(hp)) return hp;
    if (hp && this._aliases.has(hp)) return this._aliases.get(hp);
    return hp || eq || null;
  }

  getOrCreate(alvo = {}) {
    const host = alvo.host || alvo.ip || null;
    const porta = alvo.porta != null
      ? Number(alvo.porta)
      : (alvo.porta_tcp != null ? Number(alvo.porta_tcp) : null);
    const equipamentoId = alvo.equipamentoId ?? alvo.equipamento_id ?? alvo.id ?? null;

    let primary = this._resolverPrimary({ host, porta, equipamentoId });
    if (!primary) {
      primary = `anon:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    }

    let session = this._byKey.get(primary);
    if (!session) {
      const hp = chaveHostPorta(host, porta);
      const eq = chaveEquipamento(equipamentoId);
      if (hp && this._byKey.has(hp)) {
        session = this._byKey.get(hp);
        primary = hp;
      } else if (eq && this._byKey.has(eq)) {
        session = this._byKey.get(eq);
        primary = eq;
      }
    }

    if (!session) {
      session = new EquipmentSession({
        host,
        porta,
        equipamentoId,
        transporte: alvo.transporte || 'ethernet'
      });
      this._byKey.set(primary, session);
    }

    if (host) session.host = String(host);
    if (porta != null && Number.isFinite(Number(porta))) session.porta = Number(porta);
    if (equipamentoId != null) session.equipamentoId = Number(equipamentoId);

    const hp = chaveHostPorta(session.host, session.porta);
    const eq = chaveEquipamento(session.equipamentoId);
    if (hp) {
      this._byKey.set(hp, session);
      this._aliases.set(hp, hp);
      primary = hp;
    }
    if (eq) {
      this._aliases.set(eq, primary);
      if (!this._byKey.has(eq)) this._byKey.set(eq, session);
    }
    session._registryKey = primary;
    return session;
  }

  get(alvo = {}) {
    const primary = this._resolverPrimary(alvo);
    if (!primary) return null;
    return this._byKey.get(primary) || null;
  }

  bindEntry(entry) {
    if (!entry) return null;
    const session = this.getOrCreate({
      host: entry.host,
      porta: entry.porta,
      equipamentoId: entry.equipamentoId,
      transporte: entry.transporte
    });
    entry.session = session;
    return session;
  }

  clearForTests() {
    this._byKey.clear();
    this._aliases.clear();
  }

  size() {
    return new Set(this._byKey.values()).size;
  }
}

const equipmentSessionRegistry = new EquipmentSessionRegistry();

module.exports = equipmentSessionRegistry;
module.exports.EquipmentSessionRegistry = EquipmentSessionRegistry;
