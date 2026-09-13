'use strict';

/**
 * Logs de plugin — sem dados sensíveis (sem CPF, tokens, payloads completos).
 */
class PluginLogger {
  constructor(limite = 500) {
    this.limite = limite;
    /** @type {object[]} */
    this._ring = [];
  }

  /**
   * @param {{ plugin: string, evento: string, tempoMs?: number, erro?: string, ok?: boolean, memoriaMb?: number }} entry
   */
  registrar(entry) {
    const row = {
      ts: new Date().toISOString(),
      plugin: String(entry.plugin || ''),
      evento: String(entry.evento || 'exec'),
      tempoMs: entry.tempoMs != null ? Number(entry.tempoMs) : null,
      ok: entry.ok !== false,
      erro: entry.erro ? String(entry.erro).slice(0, 200) : null,
      memoriaMb: entry.memoriaMb != null ? Number(entry.memoriaMb) : null
    };
    this._ring.push(row);
    if (this._ring.length > this.limite) this._ring.shift();
    return row;
  }

  recentes(limite = 50) {
    return this._ring.slice(-limite);
  }

  porPlugin(pluginId, limite = 30) {
    return this._ring.filter((r) => r.plugin === pluginId).slice(-limite);
  }

  stats() {
    const porPlugin = {};
    let erros = 0;
    for (const r of this._ring) {
      if (!porPlugin[r.plugin]) porPlugin[r.plugin] = { exec: 0, erros: 0, tempoTotal: 0 };
      porPlugin[r.plugin].exec += 1;
      if (!r.ok) {
        porPlugin[r.plugin].erros += 1;
        erros += 1;
      }
      if (r.tempoMs != null) porPlugin[r.plugin].tempoTotal += r.tempoMs;
    }
    return { total: this._ring.length, erros, porPlugin };
  }
}

module.exports = PluginLogger;
