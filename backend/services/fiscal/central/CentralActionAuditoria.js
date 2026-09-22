/**
 * Auditoria de ações operacionais (Sprint 5).
 * Não duplica o sistema SEFAZ — registra ação operacional local.
 *
 * @module services/fiscal/central/CentralActionAuditoria
 */
'use strict';

class CentralActionAuditoria {
  constructor(deps = {}) {
    this._registros = [];
    this._emitirEvento = deps.emitirEvento || null;
    this._max = Number(deps.max) || 500;
  }

  /**
   * @param {Object} evento
   */
  async registrar(evento = {}) {
    const row = {
      action_id: evento.action_id || evento.actionId || null,
      cnpj: evento.cnpj ? String(evento.cnpj).replace(/\D/g, '') : null,
      ambiente: evento.ambiente != null ? Number(evento.ambiente) : null,
      tipo: evento.tipo || evento.acao || null,
      modo: evento.modo || null,
      origem: evento.origem || null,
      usuarioId: evento.usuarioId || evento.usuario_id || null,
      request_id: evento.request_id || evento.requestId || null,
      chave: evento.chave || null,
      documentoId: evento.documentoId || null,
      resultado: evento.resultado || null,
      motivo: evento.motivo || null,
      status: evento.status || null,
      timestamp: evento.timestamp || new Date().toISOString(),
      detalhe: evento.detalhe || null
    };
    this._registros.unshift(row);
    if (this._registros.length > this._max) this._registros.length = this._max;

    if (typeof this._emitirEvento === 'function') {
      try {
        await this._emitirEvento({
          tipo: 'CENTRAL_OPERACAO_ACAO',
          origem: row.origem || 'policy',
          descricao: `${row.tipo || 'ACAO'} — ${row.resultado || row.status || ''}`,
          sucesso: !/BLOQUEADO|ERRO|FALHA/i.test(String(row.resultado || '')),
          usuarioId: row.usuarioId,
          documentoId: row.documentoId,
          detalhe: row
        });
      } catch { /* ignore */ }
    }
    return row;
  }

  listar(filtros = {}) {
    let itens = [...this._registros];
    if (filtros.cnpj) {
      const c = String(filtros.cnpj).replace(/\D/g, '');
      itens = itens.filter((r) => r.cnpj === c);
    }
    if (filtros.ambiente != null) {
      const a = Number(filtros.ambiente) === 1 ? 1 : 2;
      itens = itens.filter((r) => Number(r.ambiente) === a);
    }
    if (filtros.action_id) {
      itens = itens.filter((r) => r.action_id === filtros.action_id);
    }
    const limite = Math.min(200, Number(filtros.limite) || 50);
    return itens.slice(0, limite);
  }
}

module.exports = CentralActionAuditoria;
