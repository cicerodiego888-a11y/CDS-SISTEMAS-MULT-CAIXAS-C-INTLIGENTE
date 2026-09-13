/**
 * Sprint 15.4 / 15.5 — ToledoSyncService
 * Orquestra sync 90AX + Delta Sync / versionamento.
 */

'use strict';

const { createEngine } = require('../protocol/Toledo90AXEngine');
const connectionManager = require('../../../connection/ConnectionManager');
const planner = require('./ToledoSyncPlanner');
const { MODOS } = require('./ToledoSyncPlanner');
const ToledoSyncExecutor = require('./ToledoSyncExecutor');
const ToledoSyncProgress = require('./ToledoSyncProgress');
const ToledoSyncHistory = require('./ToledoSyncHistory');
const ToledoSyncRepository = require('./ToledoSyncRepository');
const report = require('./ToledoSyncReport');
const validator = require('./ToledoSyncValidator');
const batchBuilder = require('./ToledoBatchBuilder');
const { SyncError, CODES } = require('./ToledoSyncErrors');
const ToledoDeltaRepository = require('./ToledoDeltaRepository');
const ToledoSnapshotService = require('./ToledoSnapshotService');
const ToledoDeltaEngine = require('./ToledoDeltaEngine');
const ToledoVersionManager = require('./ToledoVersionManager');
const ToledoLoadManager = require('./ToledoLoadManager');
const ToledoConflictResolver = require('./ToledoConflictResolver');
const ToledoSyncAudit = require('./ToledoSyncAudit');
const ToledoRollbackService = require('./ToledoRollbackService');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[sync-svc]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[sync-svc]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoSyncService {
  constructor(deps = {}) {
    this.cm = deps.connectionManager || connectionManager;
    this.engine = deps.engine || createEngine({ connectionManager: this.cm });
    this.repository = deps.repository || new ToledoSyncRepository();
    this.history = deps.history || new ToledoSyncHistory({ repository: this.repository });
    this.progress = deps.progress || new ToledoSyncProgress();
    this.executor = deps.executor || new ToledoSyncExecutor({
      engine: this.engine,
      retryPolicy: deps.retryPolicy
    });

    this.deltaRepo = deps.deltaRepository || new ToledoDeltaRepository({
      memory: deps.memory === true
    });
    this.snapshots = deps.snapshots || new ToledoSnapshotService({ repository: this.deltaRepo });
    this.deltaEngine = deps.deltaEngine || new ToledoDeltaEngine();
    this.versions = deps.versions || new ToledoVersionManager({ repository: this.deltaRepo });
    this.loads = deps.loads || new ToledoLoadManager({
      versionManager: this.versions,
      repository: this.deltaRepo
    });
    this.conflicts = deps.conflicts || new ToledoConflictResolver();
    this.audit = deps.audit || new ToledoSyncAudit({ repository: this.deltaRepo });
    this.rollbackService = deps.rollbackService || new ToledoRollbackService({
      versionManager: this.versions,
      repository: this.deltaRepo,
      executor: this.executor,
      audit: this.audit
    });

    this._ultimoRelatorio = null;
    this._ultimaCarga = null;
    this._ultimoDelta = null;
  }

  status() {
    return {
      ...this.progress.snapshot(),
      executor: this.executor.status(),
      ultimoRelatorio: this._ultimoRelatorio,
      pendentes: this._ultimaCarga?.resumo?.aExecutar ?? null,
      cargas: this.loads.status(),
      ultimoDelta: this._ultimoDelta?.resumo || null
    };
  }

  cancel() {
    this.progress.cancel();
    this.executor.cancel();
    getLogger().info('Sync cancelado', { operacao: 'toledo_sync_v15' }).catch(() => {});
    return { cancelled: true, progress: this.progress.snapshot() };
  }

  async _garantirConexao(alvo) {
    const key = {
      equipamentoId: alvo.equipamentoId,
      host: alvo.host,
      porta: alvo.porta
    };
    if (!this.cm.isConnected?.(key)) {
      await this.cm.connect({ ...key, transporte: 'ethernet', persistir: alvo.persistir !== false });
    }
    this.engine.bind(key);
    return key;
  }

  plan(modo, produtos, ultimaSync = []) {
    const m = validator.assertModo(modo);
    let plano;
    if (m === MODOS.DELTA || m === 'delta') {
      const snapAtual = this.snapshots.criar(produtos);
      const snapAnt = Array.isArray(ultimaSync)
        ? this.snapshots.criar(ultimaSync)
        : (ultimaSync?.plus ? ultimaSync : this.snapshots.criar([]));
      const delta = this.deltaEngine.compute(snapAtual, snapAnt);
      plano = planner.planDelta(delta);
    } else if (m === MODOS.FULL) {
      plano = planner.planFull(produtos, ultimaSync);
    } else {
      plano = planner.planIncremental(produtos, ultimaSync);
    }
    this._ultimaCarga = plano;
    return plano;
  }

  async computeDelta(opcoes = {}) {
    const produtos = opcoes.produtos || opcoes.cds || [];
    const snapAtual = this.snapshots.criar(produtos, {
      host: opcoes.host,
      porta: opcoes.porta,
      equipamentoId: opcoes.equipamentoId || opcoes.equipamento_id
    });

    let snapAnterior = null;
    if (opcoes.snapshotAnterior) {
      snapAnterior = opcoes.snapshotAnterior;
    } else if (opcoes.ultimaSync || opcoes.balanca) {
      snapAnterior = this.snapshots.criar(opcoes.ultimaSync || opcoes.balanca);
    } else {
      const last = await this.deltaRepo.ultimaBemSucedida({
        equipamento_id: opcoes.equipamentoId || opcoes.equipamento_id,
        host: opcoes.host,
        porta: opcoes.porta
      });
      snapAnterior = last?.snapshot || null;
    }

    const delta = this.deltaEngine.compute(snapAtual, snapAnterior);
    this._ultimoDelta = delta;
    const conflito = this.conflicts.detectar({
      produtos,
      snapshotBase: snapAtual,
      detectarSimultanea: false
    });

    return {
      success: true,
      snapshotAtual: { hash: snapAtual.hash, totalPlus: snapAtual.totalPlus, data: snapAtual.data },
      snapshotAnterior: snapAnterior
        ? {
          hash: snapAnterior.hash,
          totalPlus: snapAnterior.totalPlus,
          data: snapAnterior.data,
          versao: snapAnterior.versao
        }
        : null,
      delta,
      conflitos: conflito,
      plano: planner.planDelta(delta)
    };
  }

  async sync(modo, opcoes = {}) {
    let m = validator.assertModo(modo || opcoes.modo || 'incremental');
    if (opcoes.delta === true) m = MODOS.DELTA;

    if (opcoes.confirm !== true) {
      throw SyncError.fromCode(
        CODES.SYNC_NOT_CONFIRMED,
        'Confirme a sincronização (confirm: true).',
        { statusCode: 400 }
      );
    }

    const produtos = opcoes.produtos || opcoes.cds || opcoes.listaCds || [];
    if (!Array.isArray(produtos) || !produtos.length) {
      throw SyncError.fromCode(CODES.INVALID_INPUT, 'Informe produtos para sincronizar', {
        statusCode: 400
      });
    }

    if (m === MODOS.DELTA || m === 'delta') {
      return this.syncDelta(opcoes);
    }

    const ultima = opcoes.ultimaSync || opcoes.balanca || opcoes.snapshot || [];
    const plano = this.plan(m, produtos, ultima);
    return this._executarPlano(plano, produtos, { ...opcoes, modo: m });
  }

  async syncDelta(opcoes = {}) {
    const log = getLogger();
    if (opcoes.confirm !== true) {
      throw SyncError.fromCode(CODES.SYNC_NOT_CONFIRMED, 'Confirme a sincronização (confirm: true).', {
        statusCode: 400
      });
    }

    const produtos = opcoes.produtos || opcoes.cds || opcoes.listaCds || [];
    if (!Array.isArray(produtos) || !produtos.length) {
      throw SyncError.fromCode(CODES.INVALID_INPUT, 'Informe produtos para sincronizar', {
        statusCode: 400
      });
    }

    const preview = await this.computeDelta(opcoes);
    if (preview.conflitos && !preview.conflitos.ok && opcoes.ignorarConflitos !== true) {
      throw SyncError.fromCode(CODES.CONFLICT, 'Conflitos detectados na carga', {
        statusCode: 409,
        conflitos: preview.conflitos
      });
    }

    if (preview.delta.semAlteracoes && opcoes.forcar !== true) {
      return {
        success: true,
        modo: MODOS.DELTA,
        semAlteracoes: true,
        delta: preview.delta,
        message: 'Nenhuma alteração desde a última carga bem-sucedida',
        code: CODES.NO_CHANGES
      };
    }

    const result = await this._executarPlano(preview.plano, produtos, {
      ...opcoes,
      modo: MODOS.DELTA,
      snapshotAtual: this.snapshots.criar(produtos, {
        host: opcoes.host,
        porta: opcoes.porta,
        equipamentoId: opcoes.equipamentoId || opcoes.equipamento_id
      }),
      delta: preview.delta
    });

    await log.info('Delta sync concluído', {
      operacao: 'toledo_delta_v15',
      contexto: {
        versao: result.versao,
        hash: result.hash,
        mudancas: preview.delta.resumo
      }
    });

    return { ...result, delta: preview.delta, semAlteracoes: false };
  }

  async _executarPlano(plano, produtos, opcoes = {}) {
    const log = getLogger();
    const m = opcoes.modo || plano.modo || 'incremental';

    const vCarga = validator.validarCarga(plano.carga?.plus || [], 'PLU');
    if (!vCarga.ok && (plano.carga?.plus || []).length) {
      throw SyncError.fromCode(CODES.INVALID_INPUT, 'Carga inválida', {
        statusCode: 400,
        erros: vCarga.erros
      });
    }

    const alvo = await this._garantirConexao({
      host: opcoes.host || opcoes.ip,
      porta: opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp,
      equipamentoId: opcoes.equipamentoId || opcoes.equipamento_id,
      persistir: opcoes.persistir
    });

    const iniciadoEm = new Date().toISOString();
    const snapAtual = opcoes.snapshotAtual || this.snapshots.criar(produtos, {
      ...alvo,
      data: iniciadoEm
    });

    let syncId = null;
    let versionRec = null;

    if (opcoes.persistir !== false) {
      syncId = await this.history.registrarInicio({
        tipo: m === MODOS.DELTA ? 'SYNC_DELTA' : 'SYNC_90AX',
        modo: m,
        host: alvo.host,
        porta: alvo.porta,
        equipamentoId: alvo.equipamentoId,
        usuarioId: opcoes.usuarioId || opcoes.usuario_id,
        versaoCarga: snapAtual.hash
      });

      versionRec = await this.versions.criar(alvo, {
        hash: snapAtual.hash,
        inicio: iniciadoEm,
        usuarioId: opcoes.usuarioId || opcoes.usuario_id,
        usuario: opcoes.usuario,
        status: 'SINCRONIZANDO',
        snapshot: snapAtual,
        syncId
      });
    }

    const lotes = batchBuilder.buildFromCarga(plano.carga, {
      tamanhoLote: opcoes.tamanhoLote || 10
    });
    const totalItens = lotes.reduce((a, l) => a + l.quantidade, 0);

    this.progress.start({
      modo: m,
      syncId,
      host: alvo.host,
      porta: alvo.porta,
      equipamentoId: alvo.equipamentoId,
      totalItens,
      lotesTotal: lotes.length
    });

    if (syncId != null) {
      await this.repository.atualizarSync(syncId, { status: 'SINCRONIZANDO' });
      for (const item of plano.itens || []) {
        await this.repository.inserirItem({
          sync_id: syncId,
          produto_id: item.cds?.produto_id,
          plu: item.plu,
          acao: item.acao,
          status: 'PENDENTE'
        });
      }
    }

    if (versionRec && opcoes.delta) {
      await this.audit.registrar({
        versionId: versionRec.id,
        equipamentoId: alvo.equipamentoId,
        usuarioId: opcoes.usuarioId || opcoes.usuario_id,
        usuario: opcoes.usuario,
        campos: this.audit.fromDelta(opcoes.delta),
        resultado: 'ENVIANDO'
      });
    }

    let execucao;
    try {
      if (totalItens === 0) {
        execucao = {
          success: true,
          resultados: [],
          ok: 0,
          erro: 0,
          total: 0,
          durationMs: 0,
          lotes: [],
          avisos: []
        };
      } else {
        execucao = await this.executor.executeBatches(plano.carga, {
          ...alvo,
          confirm: true,
          tamanhoLote: opcoes.tamanhoLote || 10,
          timeoutMs: opcoes.timeoutMs || opcoes.timeout,
          progress: this.progress,
          onProgress: opcoes.onProgress,
          onRetry: opcoes.onRetry,
          onLote: opcoes.onLote
        });
      }
    } catch (err) {
      this.progress.finish(false);
      if (syncId != null) {
        await this.history.registrarFim(syncId, {
          status: err.code === CODES.SYNC_CANCELLED ? 'CANCELADO' : 'ERRO',
          falhas: 1,
          tempoMs: this.progress.snapshot().tempoMs,
          observacoes: err.message
        });
      }
      if (versionRec) {
        await this.versions.finalizar(versionRec.id, {
          status: 'FALHA',
          falhas: 1,
          tempoMs: this.progress.snapshot().tempoMs,
          observacoes: err.message,
          snapshot: snapAtual,
          hash: snapAtual.hash
        });
      }

      let rollback = null;
      if (opcoes.autoRollback !== false && m === MODOS.DELTA) {
        try {
          rollback = await this.rollbackService.rollback(alvo, {
            usuarioId: opcoes.usuarioId,
            usuario: opcoes.usuario,
            reenviar: opcoes.reenviarNoRollback === true,
            versaoFalhou: versionRec?.versao
          });
        } catch (_) { /* histórico preservado */ }
      }

      await log.error('Sync falhou', {
        operacao: 'toledo_sync_v15',
        contexto: { error: err.message, code: err.code, rollback: Boolean(rollback) }
      });
      err.meta = { ...(err.meta || {}), rollback };
      throw err;
    }

    const finalizadoEm = new Date().toISOString();
    const relatorio = report.buildReport({
      syncId,
      plano,
      execucao,
      iniciadoEm,
      finalizadoEm,
      produtosLidos: produtos.length,
      modo: m,
      lotes: execucao.lotes,
      avisos: execucao.avisos || []
    });
    this._ultimoRelatorio = relatorio;
    this.progress.finish(execucao.success);

    const statusFinal = execucao.cancelled
      ? 'CANCELADO'
      : (execucao.erro ? 'CONCLUIDO_COM_ERROS' : 'SUCESSO');

    if (syncId != null) {
      await this.history.registrarFim(syncId, {
        status: statusFinal === 'SUCESSO' ? 'CONCLUIDO' : statusFinal,
        itens: execucao.ok,
        falhas: execucao.erro,
        tempoMs: execucao.durationMs,
        relatorio,
        observacoes: `modo=${m}; hash=${snapAtual.hash}`
      });

      const detalhe = await this.repository.buscarPorId(syncId);
      if (detalhe?.itens) {
        for (const itemDb of detalhe.itens) {
          const r = execucao.resultados.find((x) => String(x.plu) === String(itemDb.plu));
          if (!r) continue;
          await this.repository.atualizarItem(itemDb.id, {
            status: r.success ? 'OK' : 'ERRO',
            erro: r.error || null,
            tentativas: r.attempts,
            tempo_ms: r.latenciaMs
          });
        }
      }
    }

    if (versionRec) {
      const versaoFinal = await this.versions.finalizar(versionRec.id, {
        status: execucao.erro ? 'FALHA' : 'SUCESSO',
        fim: finalizadoEm,
        hash: snapAtual.hash,
        snapshot: snapAtual,
        tempoMs: execucao.durationMs,
        itens: execucao.ok,
        falhas: execucao.erro
      });
      this.loads.setAtual(versaoFinal);
      await this.loads.refresh(alvo);
    }

    return {
      success: execucao.success,
      syncId,
      modo: m,
      versao: versionRec?.versao || null,
      versionId: versionRec?.id || null,
      hash: snapAtual.hash,
      plano: { resumo: plano.resumo },
      execucao,
      relatorio,
      progress: this.progress.snapshot(),
      cargas: this.loads.status()
    };
  }

  syncFull(opcoes = {}) {
    return this.sync(MODOS.FULL, opcoes);
  }

  syncIncremental(opcoes = {}) {
    return this.sync(MODOS.INCREMENTAL, opcoes);
  }

  async getHistory(filtros) {
    return this.history.listar(filtros);
  }

  async getReport(syncId) {
    if (syncId) {
      const row = await this.history.obter(syncId);
      return row?.relatorio || row;
    }
    return this._ultimoRelatorio;
  }

  async listVersions(alvo, limite) {
    return this.versions.listar(alvo, limite);
  }

  async getVersion(alvo, versao) {
    return this.versions.obter(alvo, versao);
  }

  async compareVersions(alvo, vA, vB) {
    const a = await this.versions.obter(alvo, vA);
    const b = await this.versions.obter(alvo, vB);
    return {
      success: true,
      versaoA: a.versao,
      versaoB: b.versao,
      delta: this.versions.comparar(a, b)
    };
  }

  async getAudit(filtros) {
    return this.audit.listar(filtros);
  }

  async rollback(alvo, opcoes = {}) {
    return this.rollbackService.rollback(alvo, opcoes);
  }
}

const toledoSyncService = new ToledoSyncService();

module.exports = toledoSyncService;
module.exports.ToledoSyncService = ToledoSyncService;
module.exports.toledoSyncService = toledoSyncService;
module.exports.createSyncService = (deps) => new ToledoSyncService(deps);
