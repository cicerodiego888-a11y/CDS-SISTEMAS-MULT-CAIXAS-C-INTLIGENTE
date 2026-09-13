/**
 * Sprint 15.5 — ToledoSyncAudit
 * Auditoria: produto, campo, valores, usuário, data, versão, equipamento, resultado.
 */

'use strict';

const ToledoDeltaRepository = require('./ToledoDeltaRepository');

class ToledoSyncAudit {
  constructor(deps = {}) {
    this.repository = deps.repository || new ToledoDeltaRepository({ memory: deps.memory });
  }

  /**
   * Registra lista de mudanças (delta.campos ou conflitos).
   */
  async registrar({
    versionId,
    equipamentoId,
    usuarioId,
    usuario,
    campos = [],
    resultado = 'PENDENTE'
  } = {}) {
    const entradas = (campos || []).map((c) => ({
      version_id: versionId,
      equipamento_id: equipamentoId ?? null,
      produto_id: c.produto_id ?? null,
      plu: c.plu,
      campo: c.campo,
      valor_anterior: c.valor_anterior,
      valor_novo: c.valor_novo,
      tipo: c.tipo,
      usuario_id: usuarioId ?? null,
      usuario: usuario || null,
      resultado
    }));
    if (!entradas.length) return [];
    return this.repository.salvarAudit(entradas);
  }

  async listar(filtros = {}) {
    return this.repository.listarAudit({
      version_id: filtros.versionId ?? filtros.version_id,
      equipamento_id: filtros.equipamentoId ?? filtros.equipamento_id,
      limite: filtros.limite
    });
  }

  fromDelta(delta) {
    return (delta?.campos || []).map((c) => ({ ...c }));
  }
}

module.exports = ToledoSyncAudit;
module.exports.ToledoSyncAudit = ToledoSyncAudit;
