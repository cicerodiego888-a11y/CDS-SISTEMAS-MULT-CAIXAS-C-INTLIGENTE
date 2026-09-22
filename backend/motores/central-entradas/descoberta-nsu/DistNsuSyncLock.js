/**
 * Lock de sincronização DistDFe por CNPJ + ambiente (Sprint 3).
 * Isola identidades; não bypassa Gate/Rate/Cooldown.
 *
 * @module motores/central-entradas/descoberta-nsu/DistNsuSyncLock
 */
'use strict';

class DistNsuSyncLock {
  constructor() {
    /** @type {Map<string, { dono: string, desde: string }>} */
    this._locks = new Map();
  }

  static chaveIdentidade(cnpj, ambiente) {
    const c = String(cnpj || '').replace(/\D/g, '');
    const a = Number(ambiente) === 1 ? 1 : 2;
    if (!c) return '*';
    return `${c}|${a}`;
  }

  estaExecutando(cnpj = null, ambiente = null) {
    if (cnpj == null) return this._locks.size > 0;
    return this._locks.has(DistNsuSyncLock.chaveIdentidade(cnpj, ambiente));
  }

  obterDono(cnpj, ambiente) {
    return this._locks.get(DistNsuSyncLock.chaveIdentidade(cnpj, ambiente)) || null;
  }

  listarAtivos() {
    return [...this._locks.entries()].map(([chave, v]) => ({ chave, ...v }));
  }

  /**
   * @param {string} dono
   * @param {Function} fn
   * @param {{ cnpj?: string, ambiente?: number }} [identidade]
   */
  async comLock(dono, fn, identidade = {}) {
    const key = DistNsuSyncLock.chaveIdentidade(identidade.cnpj, identidade.ambiente);
    if (this._locks.has(key)) {
      const atual = this._locks.get(key);
      return {
        sucesso: false,
        ignorado: true,
        codigo: 'SYNC_EM_ANDAMENTO',
        mensagem: `Sincronização já em andamento (${atual?.dono || 'desconhecido'})`,
        erros: ['Sincronização já em andamento.'],
        identidade: key
      };
    }
    // Lock global (*) bloqueia todas; lock específico não bloqueia outro CNPJ
    if (key !== '*' && this._locks.has('*')) {
      const atual = this._locks.get('*');
      return {
        sucesso: false,
        ignorado: true,
        codigo: 'SYNC_EM_ANDAMENTO',
        mensagem: `Sincronização já em andamento (${atual?.dono || 'global'})`,
        erros: ['Sincronização já em andamento.'],
        identidade: key
      };
    }

    this._locks.set(key, { dono: dono || 'dist-dfe', desde: new Date().toISOString() });
    try {
      return await fn();
    } finally {
      this._locks.delete(key);
    }
  }
}

const singleton = new DistNsuSyncLock();

module.exports = DistNsuSyncLock;
module.exports.obterDistNsuSyncLock = () => singleton;
module.exports.singleton = singleton;
