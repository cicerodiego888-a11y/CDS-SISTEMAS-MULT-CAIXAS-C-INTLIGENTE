/**
 * Snapshot em memória do último resultado de reconciliação (Sprint 4).
 * Não mascara dados novos — apenas cache do último diagnóstico.
 *
 * @module services/fiscal/descoberta-nsu/ReconcilicaoDfeSnapshotStore
 */
'use strict';

class ReconcilicaoDfeSnapshotStore {
  constructor() {
    /** @type {Map<string, Object>} */
    this._map = new Map();
  }

  static chave(cnpj, ambiente) {
    const c = String(cnpj || '').replace(/\D/g, '');
    const a = Number(ambiente) === 1 ? 1 : 2;
    return `${c}|${a}`;
  }

  salvar(cnpj, ambiente, resultado) {
    const key = ReconcilicaoDfeSnapshotStore.chave(cnpj, ambiente);
    const snap = {
      ...resultado,
      snapshotEm: new Date().toISOString()
    };
    this._map.set(key, snap);
    return snap;
  }

  obter(cnpj, ambiente) {
    return this._map.get(ReconcilicaoDfeSnapshotStore.chave(cnpj, ambiente)) || null;
  }

  limpar(cnpj = null, ambiente = null) {
    if (cnpj == null) {
      this._map.clear();
      return;
    }
    this._map.delete(ReconcilicaoDfeSnapshotStore.chave(cnpj, ambiente));
  }
}

const singleton = new ReconcilicaoDfeSnapshotStore();

module.exports = ReconcilicaoDfeSnapshotStore;
module.exports.obterSnapshotStore = () => singleton;
module.exports.singleton = singleton;
