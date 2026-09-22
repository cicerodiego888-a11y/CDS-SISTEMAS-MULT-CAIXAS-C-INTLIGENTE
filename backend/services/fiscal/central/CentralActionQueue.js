/**
 * Fila de ações pendentes (modo ASSISTIDO) — Sprint 5.
 * @module services/fiscal/central/CentralActionQueue
 */
'use strict';

const { criarActionId } = require('./CentralActionId');

class CentralActionQueue {
  constructor() {
    /** @type {Map<string, Object>} */
    this._itens = new Map();
  }

  static chaveIdentidade(cnpj, ambiente) {
    const c = String(cnpj || '').replace(/\D/g, '');
    const a = Number(ambiente) === 1 ? 1 : 2;
    return `${c}|${a}`;
  }

  enfileirar(acao) {
    const actionId = acao.action_id || acao.actionId || criarActionId();
    const item = {
      ...acao,
      action_id: actionId,
      status: acao.status || 'PENDENTE',
      createdAt: acao.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this._itens.set(actionId, item);
    return item;
  }

  obter(actionId) {
    return this._itens.get(actionId) || null;
  }

  atualizar(actionId, patch = {}) {
    const cur = this._itens.get(actionId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this._itens.set(actionId, next);
    return next;
  }

  listarPendentes(cnpj = null, ambiente = null) {
    let itens = [...this._itens.values()].filter((i) => i.status === 'PENDENTE');
    if (cnpj != null) {
      const c = String(cnpj).replace(/\D/g, '');
      const a = Number(ambiente) === 1 ? 1 : 2;
      itens = itens.filter((i) => String(i.cnpj || '').replace(/\D/g, '') === c && Number(i.ambiente) === a);
    }
    return itens.sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
  }

  remover(actionId) {
    return this._itens.delete(actionId);
  }

  limpar() {
    this._itens.clear();
  }
}

const singleton = new CentralActionQueue();

module.exports = CentralActionQueue;
module.exports.obterActionQueue = () => singleton;
module.exports.singleton = singleton;
