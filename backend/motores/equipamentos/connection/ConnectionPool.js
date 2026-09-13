/**
 * Sprint 15.1 — ConnectionPool V2
 * Uma conexão por equipamento (e por host:porta).
 */

'use strict';

function chaveHostPorta(host, porta) {
  return `hp:${String(host)}:${Number(porta)}`;
}

function chaveEquipamento(id) {
  return `eq:${String(id)}`;
}

function chaveSerial(portaCom) {
  return `serial:${String(portaCom)}`;
}

function chaveUsb(vid, pid, caminho) {
  if (caminho) return `usb:path:${String(caminho)}`;
  return `usb:${String(vid || '')}:${String(pid || '')}`;
}

class ConnectionPool {
  constructor() {
    /** @type {Map<string, object>} */
    this._mapa = new Map();
    /** @type {Map<string, string>} aliases → chave primária */
    this._aliases = new Map();
  }

  key(host, porta) {
    return chaveHostPorta(host, porta);
  }

  _resolverChave(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') {
      if (this._mapa.has(ref)) return ref;
      return this._aliases.get(ref) || ref;
    }
    if (ref.equipamentoId != null || ref.equipamento_id != null) {
      return chaveEquipamento(ref.equipamentoId ?? ref.equipamento_id);
    }
    if (ref.porta_com) return chaveSerial(ref.porta_com);
    if (ref.vid || ref.pid || ref.caminho_dispositivo) {
      return chaveUsb(ref.vid, ref.pid, ref.caminho_dispositivo);
    }
    if (ref.host || ref.ip) {
      return chaveHostPorta(ref.host || ref.ip, ref.porta || ref.porta_tcp);
    }
    return null;
  }

  get(hostOrRef, porta) {
    if (typeof hostOrRef === 'object' && hostOrRef !== null) {
      const k = this._resolverChave(hostOrRef);
      if (!k) return null;
      // RC15.6 — resolve alias (eq:N → hp:… e vice-versa); nunca buscar só a chave lógica
      const primary = this._aliases.get(k) || k;
      return this._mapa.get(primary) || this._mapa.get(k) || null;
    }
    if (porta != null) {
      const k = chaveHostPorta(hostOrRef, porta);
      const primary = this._aliases.get(k) || k;
      return this._mapa.get(primary) || null;
    }
    const primary = this._aliases.get(String(hostOrRef)) || String(hostOrRef);
    return this._mapa.get(primary) || null;
  }

  has(hostOrRef, porta) {
    return Boolean(this.get(hostOrRef, porta));
  }

  /**
   * Overload V1: set(host, porta, entry)
   * Overload V2: set(chaves, entry)
   */
  set(hostOrChaves, portaOrEntry, maybeEntry) {
    if (typeof hostOrChaves === 'string' && typeof portaOrEntry === 'number') {
      const entry = maybeEntry;
      const primary = chaveHostPorta(hostOrChaves, portaOrEntry);
      this._mapa.set(primary, entry);
      this._aliases.set(primary, primary);
      if (entry?.equipamentoId != null) {
        this._aliases.set(chaveEquipamento(entry.equipamentoId), primary);
      }
      if (entry) entry._poolKey = primary;
      return entry;
    }

    const chaves = hostOrChaves || {};
    const entry = portaOrEntry;
    let primary = null;
    if (chaves.equipamentoId != null || chaves.equipamento_id != null) {
      primary = chaveEquipamento(chaves.equipamentoId ?? chaves.equipamento_id);
    } else if (chaves.porta_com) {
      primary = chaveSerial(chaves.porta_com);
    } else if (chaves.host || chaves.ip) {
      primary = chaveHostPorta(chaves.host || chaves.ip, chaves.porta || chaves.porta_tcp);
    } else if (chaves.vid || chaves.caminho_dispositivo) {
      primary = chaveUsb(chaves.vid, chaves.pid, chaves.caminho_dispositivo);
    } else {
      primary = `anon:${Date.now()}`;
    }

    this._mapa.set(primary, entry);
    this._aliases.set(primary, primary);
    if (chaves.host || chaves.ip) {
      this._aliases.set(
        chaveHostPorta(chaves.host || chaves.ip, chaves.porta || chaves.porta_tcp),
        primary
      );
    }
    if (chaves.equipamentoId != null || chaves.equipamento_id != null) {
      this._aliases.set(chaveEquipamento(chaves.equipamentoId ?? chaves.equipamento_id), primary);
    }
    if (entry) entry._poolKey = primary;
    return entry;
  }

  delete(hostOrRef, porta) {
    let primary = null;
    if (typeof hostOrRef === 'object' && hostOrRef !== null) {
      primary = this._resolverChave(hostOrRef);
    } else if (porta != null) {
      const k = chaveHostPorta(hostOrRef, porta);
      primary = this._aliases.get(k) || k;
    } else {
      primary = this._aliases.get(String(hostOrRef)) || String(hostOrRef);
    }
    if (!primary) return false;
    const removed = this._mapa.delete(primary);
    for (const [alias, target] of [...this._aliases.entries()]) {
      if (alias === primary || target === primary) this._aliases.delete(alias);
    }
    return removed;
  }

  acquire(host, porta, factoryFn) {
    const existente = this.get(host, porta);
    if (existente) return { entry: existente, created: false };
    const entry = factoryFn();
    this.set(host, porta, entry);
    return { entry, created: true };
  }

  listar() {
    return [...this._mapa.entries()].map(([k, entry]) => ({
      key: k,
      ...(entry.meta || {}),
      estado: entry.fsm?.estado || entry.health?.status || null,
      equipamentoId: entry.equipamentoId || null
    }));
  }

  entries() {
    return [...this._mapa.entries()];
  }

  size() {
    return this._mapa.size;
  }

  clear() {
    this._mapa.clear();
    this._aliases.clear();
  }
}

module.exports = ConnectionPool;
module.exports.ConnectionPool = ConnectionPool;
module.exports.chave = chaveHostPorta;
module.exports.chaveHostPorta = chaveHostPorta;
module.exports.chaveEquipamento = chaveEquipamento;
