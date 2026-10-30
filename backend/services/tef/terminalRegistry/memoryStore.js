'use strict';

/**
 * Store em memória do Registry (MRT-03).
 * Não persiste no banco oficial. Útil para testes e cadastro lógico futuro.
 */

const { criarTerminalTef } = require('./contracts');

function criarMemoryStore(sementes = []) {
  /** @type {Map<string, object>} */
  const porId = new Map();
  /** @type {Map<string, Set<string>>} pdvId → terminal ids */
  const porPdv = new Map();

  function indexar(terminal) {
    const t = criarTerminalTef(terminal);
    if (!t.id || !t.pdvId) {
      throw new Error('Terminal TEF exige id e pdvId');
    }
    porId.set(t.id, t);
    if (!porPdv.has(t.pdvId)) porPdv.set(t.pdvId, new Set());
    porPdv.get(t.pdvId).add(t.id);
    return t;
  }

  for (const s of sementes) {
    indexar(s);
  }

  return {
    upsert(terminal) {
      return indexar(terminal);
    },
    remove(terminalId) {
      const id = String(terminalId);
      const atual = porId.get(id);
      if (!atual) return false;
      porId.delete(id);
      const set = porPdv.get(atual.pdvId);
      if (set) {
        set.delete(id);
        if (set.size === 0) porPdv.delete(atual.pdvId);
      }
      return true;
    },
    getById(terminalId) {
      return porId.get(String(terminalId)) || null;
    },
    listByPdv(pdvId) {
      const set = porPdv.get(String(pdvId));
      if (!set) return [];
      return [...set].map((id) => porId.get(id)).filter(Boolean);
    },
    listAll() {
      return [...porId.values()];
    },
    clear() {
      porId.clear();
      porPdv.clear();
    },
    size() {
      return porId.size;
    }
  };
}

module.exports = {
  criarMemoryStore
};
