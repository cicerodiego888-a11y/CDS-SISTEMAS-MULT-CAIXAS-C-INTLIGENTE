/**
 * Sprint 15.2 — ToledoCommandRegistry
 * Centraliza comandos conhecidos e suas estratégias.
 */

'use strict';

const commands = require('./commands');
const { CommandNotFoundError } = require('./ToledoProtocolErrors');

class ToledoCommandRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._mapa = new Map();
    this._carregarPadrao();
  }

  _carregarPadrao() {
    for (const [nome, def] of Object.entries(commands)) {
      if (def && def.name) this.registrar(def.name, def);
      this.registrar(nome, def);
    }
  }

  registrar(nome, definicao) {
    this._mapa.set(String(nome).toLowerCase(), definicao);
    return this;
  }

  obter(nome) {
    const key = String(nome || '').toLowerCase();
    const def = this._mapa.get(key);
    if (!def) throw new CommandNotFoundError(nome);
    return def;
  }

  tem(nome) {
    return this._mapa.has(String(nome || '').toLowerCase());
  }

  listar() {
    const vistos = new Set();
    const out = [];
    for (const [k, v] of this._mapa.entries()) {
      if (vistos.has(v)) continue;
      vistos.add(v);
      out.push({
        name: v.name || k,
        wireCommand: v.wireCommand,
        timeoutMs: v.timeoutMs,
        retries: v.retries,
        describe: v.describe
      });
    }
    return out;
  }
}

const registry = new ToledoCommandRegistry();

module.exports = registry;
module.exports.ToledoCommandRegistry = ToledoCommandRegistry;
module.exports.registry = registry;
