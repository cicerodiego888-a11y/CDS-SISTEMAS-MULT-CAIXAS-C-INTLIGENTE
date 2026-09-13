/**
 * Sprint 15.5 — ToledoLoadManager
 * Controla carga atual, anterior, última OK, última falha, tempo médio.
 */

'use strict';

class ToledoLoadManager {
  constructor(deps = {}) {
    this.versionManager = deps.versionManager || null;
    this.repository = deps.repository || (deps.versionManager && deps.versionManager.repository);
    this._cache = {
      atual: null,
      anterior: null
    };
  }

  async refresh(alvo = {}) {
    if (!this.repository) {
      return this.status();
    }
    const list = await this.repository.listarVersoes({
      equipamento_id: alvo.equipamentoId ?? alvo.equipamento_id,
      host: alvo.host,
      porta: alvo.porta,
      limite: 30
    });
    this._cache.atual = list[0] || null;
    this._cache.anterior = list[1] || null;
    this._cache.sucesso = list.find((v) => v.status === 'SUCESSO' || v.status === 'CONCLUIDO') || null;
    this._cache.falha = list.find((v) =>
      v.status === 'FALHA' || v.status === 'ERRO' || v.status === 'ROLLBACK') || null;

    const tempos = list
      .filter((v) => v.tempo_ms != null && Number(v.tempo_ms) > 0)
      .map((v) => Number(v.tempo_ms));
    this._cache.tempoMedioMs = tempos.length
      ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
      : null;
    this._cache.versoes = list.length;
    return this.status();
  }

  setAtual(versionRow) {
    this._cache.anterior = this._cache.atual;
    this._cache.atual = versionRow;
  }

  status() {
    return {
      cargaAtual: summarize(this._cache.atual),
      cargaAnterior: summarize(this._cache.anterior),
      ultimaBemSucedida: summarize(this._cache.sucesso),
      ultimaFalha: summarize(this._cache.falha),
      tempoMedioMs: this._cache.tempoMedioMs ?? null,
      totalVersoes: this._cache.versoes ?? 0
    };
  }
}

function summarize(v) {
  if (!v) return null;
  return {
    id: v.id,
    versao: v.versao,
    hash: v.hash,
    status: v.status,
    inicio: v.inicio,
    fim: v.fim,
    tempoMs: v.tempo_ms,
    itens: v.itens,
    falhas: v.falhas,
    usuario: v.usuario
  };
}

module.exports = ToledoLoadManager;
module.exports.ToledoLoadManager = ToledoLoadManager;
