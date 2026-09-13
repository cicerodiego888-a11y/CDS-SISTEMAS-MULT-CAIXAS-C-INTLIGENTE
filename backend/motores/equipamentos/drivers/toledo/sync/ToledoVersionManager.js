/**
 * Sprint 15.5 — ToledoVersionManager
 * Versionamento de cargas: número, data, usuário, hash, resultado.
 */

'use strict';

const ToledoDeltaRepository = require('./ToledoDeltaRepository');
const { SyncError, CODES } = require('./ToledoSyncErrors');

class ToledoVersionManager {
  constructor(deps = {}) {
    this.repository = deps.repository || new ToledoDeltaRepository({ memory: deps.memory });
  }

  _key(alvo = {}) {
    return {
      equipamento_id: alvo.equipamentoId ?? alvo.equipamento_id ?? null,
      host: alvo.host || null,
      porta: alvo.porta != null ? Number(alvo.porta) : null
    };
  }

  async criar(alvo, meta = {}) {
    const key = this._key(alvo);
    const versao = meta.versao != null
      ? Number(meta.versao)
      : await this.repository.proximaVersao(key);
    const id = await this.repository.salvarVersao({
      ...key,
      versao,
      hash: meta.hash || null,
      inicio: meta.inicio || new Date().toISOString(),
      usuario_id: meta.usuarioId ?? meta.usuario_id ?? null,
      usuario: meta.usuario || null,
      status: meta.status || 'INICIADO',
      snapshot: meta.snapshot || null,
      sync_id: meta.syncId ?? meta.sync_id ?? null,
      observacoes: meta.observacoes || null
    });
    return { id, versao, ...key };
  }

  async finalizar(versionId, dados = {}) {
    await this.repository.atualizarVersao(versionId, {
      status: dados.status || 'SUCESSO',
      fim: dados.fim || new Date().toISOString(),
      hash: dados.hash,
      snapshot: dados.snapshot,
      tempo_ms: dados.tempoMs ?? dados.tempo_ms,
      itens: dados.itens,
      falhas: dados.falhas,
      observacoes: dados.observacoes
    });
    return this.repository.obterPorId(versionId);
  }

  async listar(alvo, limite = 50) {
    return this.repository.listarVersoes({ ...this._key(alvo), limite });
  }

  async obter(alvo, versao) {
    const row = await this.repository.obterVersao(this._key(alvo), versao);
    if (!row) {
      throw SyncError.fromCode(CODES.NOT_FOUND, `Versão ${versao} não encontrada`, {
        statusCode: 404
      });
    }
    return row;
  }

  async obterPorId(id) {
    const row = await this.repository.obterPorId(id);
    if (!row) {
      throw SyncError.fromCode(CODES.NOT_FOUND, 'Versão não encontrada', { statusCode: 404 });
    }
    return row;
  }

  comparar(vA, vB) {
    const deltaEngine = require('./ToledoDeltaEngine');
    return deltaEngine.compute(vA?.snapshot || vA, vB?.snapshot || vB);
  }
}

module.exports = ToledoVersionManager;
module.exports.ToledoVersionManager = ToledoVersionManager;
