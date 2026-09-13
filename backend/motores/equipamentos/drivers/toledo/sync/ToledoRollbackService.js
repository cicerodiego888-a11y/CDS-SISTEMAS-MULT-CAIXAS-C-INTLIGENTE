/**
 * Sprint 15.5 — ToledoRollbackService
 * Em falha, restaura referência à última carga consistente (snapshot).
 * Nunca apaga histórico.
 */

'use strict';

const { SyncError, CODES } = require('./ToledoSyncErrors');

class ToledoRollbackService {
  /**
   * @param {object} deps
   * @param {object} deps.versionManager
   * @param {object} deps.repository
   * @param {object} [deps.executor] — opcional reenvio da carga anterior via 90AX
   */
  constructor(deps = {}) {
    this.versionManager = deps.versionManager;
    this.repository = deps.repository || deps.versionManager?.repository;
    this.executor = deps.executor || null;
    this.audit = deps.audit || null;
  }

  /**
   * Marca rollback e retorna snapshot da última versão bem-sucedida.
   * Se reenviar=true e executor disponível, reenvia carga anterior.
   */
  async rollback(alvo = {}, opcoes = {}) {
    if (!this.repository) {
      throw SyncError.fromCode(CODES.SYNC_FAILED, 'Repositório de versões indisponível');
    }

    const key = {
      equipamento_id: alvo.equipamentoId ?? alvo.equipamento_id,
      host: alvo.host,
      porta: alvo.porta
    };

    let alvoVersao = null;
    if (opcoes.versao != null) {
      alvoVersao = await this.repository.obterVersao(key, opcoes.versao);
    } else {
      alvoVersao = await this.repository.ultimaBemSucedida(key);
    }

    if (!alvoVersao || !alvoVersao.snapshot) {
      throw SyncError.fromCode(
        CODES.NOT_FOUND,
        'Nenhuma carga consistente disponível para rollback',
        { statusCode: 404 }
      );
    }

    const inicio = new Date().toISOString();
    const versaoNum = await this.repository.proximaVersao(key);
    const rollbackId = await this.repository.salvarVersao({
      ...key,
      versao: versaoNum,
      hash: alvoVersao.hash,
      inicio,
      usuario_id: opcoes.usuarioId ?? opcoes.usuario_id,
      usuario: opcoes.usuario,
      status: 'ROLLBACK_INICIADO',
      snapshot: alvoVersao.snapshot,
      observacoes: `Rollback para versão ${alvoVersao.versao}`
    });

    let execucao = null;
    if (opcoes.reenviar === true && this.executor) {
      const snap = alvoVersao.snapshot;
      const carga = {
        plus: snap.plus || [],
        departamentos: snap.departamentos || [],
        precos: snap.precos || [],
        etiquetas: snap.etiquetas || []
      };
      try {
        execucao = await this.executor.executeBatches(carga, {
          host: alvo.host,
          porta: alvo.porta,
          equipamentoId: alvo.equipamentoId ?? alvo.equipamento_id,
          confirm: true,
          tamanhoLote: opcoes.tamanhoLote || 10
        });
      } catch (err) {
        await this.repository.atualizarVersao(rollbackId, {
          status: 'FALHA',
          fim: new Date().toISOString(),
          falhas: 1,
          observacoes: `Rollback falhou: ${err.message}`
        });
        throw err;
      }
    }

    const fim = new Date().toISOString();
    await this.repository.atualizarVersao(rollbackId, {
      status: 'ROLLBACK',
      fim,
      tempo_ms: Date.now() - new Date(inicio).getTime(),
      itens: execucao?.ok ?? (alvoVersao.snapshot.plus || []).length,
      falhas: execucao?.erro ?? 0,
      observacoes: `Restaurado snapshot da versão ${alvoVersao.versao} (hash ${alvoVersao.hash})`
    });

    if (this.audit) {
      await this.audit.registrar({
        versionId: rollbackId,
        equipamentoId: key.equipamento_id,
        usuarioId: opcoes.usuarioId,
        usuario: opcoes.usuario,
        campos: [{
          plu: null,
          campo: 'snapshot',
          valor_anterior: opcoes.versaoFalhou || null,
          valor_novo: alvoVersao.versao,
          tipo: 'ROLLBACK'
        }],
        resultado: 'ROLLBACK'
      });
    }

    return {
      success: true,
      rollbackVersionId: rollbackId,
      rollbackVersao: versaoNum,
      restoredFrom: {
        id: alvoVersao.id,
        versao: alvoVersao.versao,
        hash: alvoVersao.hash
      },
      snapshot: alvoVersao.snapshot,
      execucao,
      reenviado: Boolean(execucao)
    };
  }
}

module.exports = ToledoRollbackService;
module.exports.ToledoRollbackService = ToledoRollbackService;
