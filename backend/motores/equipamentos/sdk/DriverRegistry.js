/**
 * Sprint 15.7 — DriverRegistry (SDK): perfis instalados por id/categoria/fabricante.
 */

'use strict';

class DriverRegistry {
  constructor() {
    /** @type {Map<string, import('./DeviceProfile')>} */
    this._byId = new Map();
    this._carregadoEm = null;
    this._ultimoRelatorio = null;
  }

  registrar(profile) {
    if (!profile || !profile.id) {
      throw new Error('Profile inválido para registro (id obrigatório)');
    }
    this._byId.set(String(profile.id), profile);
    // alias por codigo legado
    if (profile.codigo && profile.codigo !== profile.id) {
      this._byId.set(String(profile.codigo), profile);
    }
    return profile;
  }

  remover(id) {
    const p = this.buscar(id);
    if (!p) return false;
    this._byId.delete(p.id);
    if (p.codigo) this._byId.delete(p.codigo);
    return true;
  }

  buscar(id) {
    if (!id) return null;
    const key = String(id);
    if (this._byId.has(key)) return this._byId.get(key);
    // RC14.14.3 — aliases Toledo
    try {
      const identity = require('./DriverIdentityResolver');
      if (identity.ehToledo(key)) {
        for (const alias of [identity.CODIGO_OFICIAL, identity.CODIGO_SDK, 'TOLEDO_PRIX4']) {
          if (this._byId.has(alias)) return this._byId.get(alias);
        }
      }
    } catch (_) { /* ignore */ }
    const lower = key.toLowerCase();
    for (const p of this._unique()) {
      if (String(p.id).toLowerCase() === lower || String(p.codigo || '').toLowerCase() === lower) {
        return p;
      }
    }
    return null;
  }

  /** RC14.14.3 — alias → mesmo profile */
  registrarAlias(idCanonico, alias) {
    const p = this.buscar(idCanonico);
    if (!p || !alias) return false;
    this._byId.set(String(alias), p);
    return true;
  }

  _unique() {
    const seen = new Set();
    const out = [];
    for (const p of this._byId.values()) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }

  listar(filtros = {}) {
    let lista = this._unique().map((p) => (typeof p.toJSON === 'function' ? p.toJSON() : p));

    if (filtros.categoria) {
      const c = String(filtros.categoria).toLowerCase();
      lista = lista.filter((p) => String(p.categoria).toLowerCase() === c);
    }
    if (filtros.fabricante) {
      const f = String(filtros.fabricante).toLowerCase();
      lista = lista.filter((p) => String(p.fabricante).toLowerCase() === f);
    }
    if (filtros.capability) {
      const cap = String(filtros.capability).toLowerCase();
      lista = lista.filter((p) => {
        const m = p.capabilities || {};
        return m[cap] === true || (p.capabilitiesLista || []).includes(cap);
      });
    }

    return lista.sort((a, b) => {
      const pa = Number(a.prioridade) || 100;
      const pb = Number(b.prioridade) || 100;
      if (pa !== pb) return pa - pb;
      return String(a.fabricante).localeCompare(String(b.fabricante));
    });
  }

  listarCategorias() {
    const map = new Map();
    for (const p of this._unique()) {
      const cat = p.categoria || 'outro';
      if (!map.has(cat)) map.set(cat, { categoria: cat, quantidade: 0, drivers: [] });
      const row = map.get(cat);
      row.quantidade += 1;
      row.drivers.push(p.id);
    }
    return Array.from(map.values()).sort((a, b) => a.categoria.localeCompare(b.categoria));
  }

  listarFabricantes() {
    const map = new Map();
    for (const p of this._unique()) {
      const f = p.fabricante || 'Desconhecido';
      if (!map.has(f)) map.set(f, { fabricante: f, quantidade: 0, drivers: [] });
      const row = map.get(f);
      row.quantidade += 1;
      row.drivers.push(p.id);
    }
    return Array.from(map.values()).sort((a, b) => a.fabricante.localeCompare(b.fabricante));
  }

  definirRelatorio(relatorio) {
    this._ultimoRelatorio = relatorio;
    this._carregadoEm = relatorio?.timestamp || new Date().toISOString();
  }

  obterRelatorio() {
    return this._ultimoRelatorio;
  }

  limpar() {
    this._byId.clear();
    this._ultimoRelatorio = null;
    this._carregadoEm = null;
  }

  tamanho() {
    return this._unique().length;
  }
}

const driverRegistry = new DriverRegistry();

module.exports = driverRegistry;
module.exports.DriverRegistry = DriverRegistry;
