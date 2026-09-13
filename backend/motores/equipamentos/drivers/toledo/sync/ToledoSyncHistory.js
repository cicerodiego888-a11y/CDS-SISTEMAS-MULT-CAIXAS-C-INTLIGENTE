/**
 * Sprint 15.4 — ToledoSyncHistory
 * Fachada de histórico: data, usuário, equipamento, produtos, tempo, resultado, falhas, versão.
 */

'use strict';

const ToledoSyncRepository = require('./ToledoSyncRepository');

class ToledoSyncHistory {
  constructor(deps = {}) {
    this.repository = deps.repository || new ToledoSyncRepository();
  }

  async listar(filtros = {}) {
    const rows = await this.repository.historico({
      limite: filtros.limite,
      host: filtros.host,
      porta: filtros.porta,
      equipamento_id: filtros.equipamentoId || filtros.equipamento_id,
      modo: filtros.modo
    });
    return rows.map(normalizeRow);
  }

  async obter(id) {
    const row = await this.repository.buscarPorId(id);
    return row ? normalizeRow(row) : null;
  }

  async registrarInicio(dados = {}) {
    return this.repository.criarSync({
      tipo: dados.tipo || 'SYNC_90AX',
      modo: dados.modo,
      host: dados.host,
      porta: dados.porta,
      equipamento_id: dados.equipamentoId || dados.equipamento_id,
      usuario_id: dados.usuarioId || dados.usuario_id,
      versao_carga: dados.versaoCarga || dados.versao_carga
    });
  }

  async registrarFim(syncId, dados = {}) {
    await this.repository.atualizarSync(syncId, {
      status: dados.status || (dados.falhas ? 'CONCLUIDO_COM_ERROS' : 'CONCLUIDO'),
      produtos_enviados: dados.itens ?? dados.produtos_enviados,
      erros: dados.falhas ?? dados.erros,
      tempo_ms: dados.tempoMs ?? dados.tempo_ms,
      observacoes: dados.observacoes,
      relatorio_json: dados.relatorio != null
        ? (typeof dados.relatorio === 'string' ? dados.relatorio : JSON.stringify(dados.relatorio))
        : undefined,
      finalizar: true
    });
  }
}

function normalizeRow(row) {
  if (!row) return null;
  let relatorio = row.relatorio;
  if (!relatorio && row.relatorio_json) {
    try { relatorio = JSON.parse(row.relatorio_json); } catch (_) { relatorio = row.relatorio_json; }
  }
  return {
    id: row.id,
    equipamentoId: row.equipamento_id,
    tipo: row.tipo,
    modo: row.modo,
    usuarioId: row.usuario_id,
    inicio: row.iniciado_em,
    fim: row.finalizado_em,
    tempoMs: row.tempo_ms,
    itens: row.produtos_enviados,
    sucesso: !row.erros && String(row.status || '').startsWith('CONCLUIDO'),
    falhas: row.erros || 0,
    observacoes: row.observacoes || null,
    versaoCarga: row.versao_carga || null,
    status: row.status,
    host: row.host,
    porta: row.porta,
    relatorio,
    itensDetalhe: row.itens || undefined
  };
}

module.exports = ToledoSyncHistory;
module.exports.ToledoSyncHistory = ToledoSyncHistory;
module.exports.normalizeRow = normalizeRow;
