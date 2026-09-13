/**
 * Sprint 14.8 — ToledoSyncEngine
 * Orquestra: Download → Comparator → Planner → Executor → Report
 */

'use strict';

const ToledoDownloadEngine = require('./ToledoDownloadEngine');
const comparator = require('./ToledoSyncComparator');
const planner = require('./ToledoSyncPlanner');
const ToledoSyncExecutor = require('./ToledoSyncExecutor');
const ToledoSyncRepository = require('./ToledoSyncRepository');
const report = require('./ToledoSyncReport');
const { SyncError, CODES } = require('./ToledoSyncErrors');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[sync-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[sync-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoSyncEngine {
  constructor(deps = {}) {
    this.downloadEngine = deps.downloadEngine || new ToledoDownloadEngine({
      persistir: deps.persistir !== false,
      driverFactory: deps.driverFactory,
      drivers: deps.drivers,
      operationEngine: deps.operationEngine
    });
    this.executor = deps.executor || new ToledoSyncExecutor({
      persistir: deps.persistir !== false,
      driverFactory: deps.driverFactory,
      drivers: deps.drivers,
      operationEngine: deps.operationEngine,
      pluEngine: deps.pluEngine
    });
    this.repository = deps.repository || new ToledoSyncRepository();
    this._session = {
      syncId: null,
      plusBalanca: [],
      comparacao: [],
      plano: null,
      iniciadoEm: null,
      host: null,
      porta: null
    };
    this._status = {
      running: false,
      phase: 'idle',
      lidos: 0,
      total: 0,
      done: 0
    };
  }

  status() {
    return {
      ...this._status,
      download: this.downloadEngine.status(),
      executor: this.executor.status(),
      session: {
        syncId: this._session.syncId,
        plusCount: this._session.plusBalanca.length,
        hasPlano: !!this._session.plano
      }
    };
  }

  cancel() {
    this.downloadEngine.cancel();
    this.executor.cancel();
    return { cancelled: true };
  }

  /**
   * Download de PLUs da balança.
   */
  async download(opcoes = {}) {
    const log = getLogger();
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    const iniciadoEm = new Date().toISOString();

    this._status = { running: true, phase: 'download', lidos: 0, total: 0, done: 0 };

    let syncId = null;
    if (opcoes.persistir !== false) {
      syncId = await this.repository.criarSync({ tipo: 'PLU_DOWNLOAD', host, porta });
    }

    try {
      let result;
      if (opcoes.from != null && opcoes.to != null) {
        result = await this.downloadEngine.downloadRange(opcoes.from, opcoes.to, {
          ...opcoes,
          onProgress: (p) => {
            this._status.lidos = p.lidos;
            this._status.total = p.total;
            if (typeof opcoes.onProgress === 'function') opcoes.onProgress(p);
          }
        });
      } else if (opcoes.range && !opcoes.range.all) {
        result = await this.downloadEngine.download({
          ...opcoes,
          onProgress: (p) => {
            this._status.lidos = p.lidos;
            this._status.total = p.total;
            if (typeof opcoes.onProgress === 'function') opcoes.onProgress(p);
          }
        });
      } else {
        result = await this.downloadEngine.downloadAll({
          ...opcoes,
          onProgress: (p) => {
            this._status.lidos = p.lidos;
            this._status.total = p.total;
            if (typeof opcoes.onProgress === 'function') opcoes.onProgress(p);
          }
        });
      }

      this._session = {
        syncId,
        plusBalanca: result.plus,
        comparacao: [],
        plano: null,
        iniciadoEm,
        host,
        porta
      };

      if (syncId != null) {
        await this.repository.atualizarSync(syncId, {
          status: 'DOWNLOAD_OK',
          produtos_lidos: result.total
        });
      }

      this._status.running = false;
      this._status.phase = 'downloaded';
      this._status.lidos = result.total;
      this._status.total = result.total;

      return {
        success: true,
        syncId,
        plus: result.plus,
        total: result.total,
        range: result.range,
        duration: result.duration
      };
    } catch (err) {
      this._status.running = false;
      this._status.phase = 'error';
      if (syncId != null) {
        try {
          await this.repository.atualizarSync(syncId, {
            status: 'ERRO',
            erros: 1,
            finalizar: true
          });
        } catch (_) { /* ignore */ }
      }
      await log.error('Download falhou', {
        operacao: 'plu_sync_v1',
        contexto: { error: err.message || err.code }
      });
      throw err;
    }
  }

  /**
   * Compara CDS × Balança e gera plano (sem executar).
   */
  async compare(opcoes = {}) {
    const log = getLogger();
    const cdsLista = opcoes.produtos || opcoes.cds || opcoes.listaCds || [];
    const balancaLista = opcoes.balanca
      || opcoes.plus
      || this._session.plusBalanca
      || [];

    if (!Array.isArray(cdsLista)) {
      throw SyncError.fromCode(CODES.INVALID_INPUT, 'produtos CDS inválidos', { statusCode: 400 });
    }

    const comparacao = comparator.compare(cdsLista, balancaLista);
    const plano = planner.plan(comparacao);

    await log.info('Comparação', {
      operacao: 'plu_sync_v1',
      contexto: { total: comparacao.length, resumo: plano.resumo }
    });
    await log.info('Plano gerado', {
      operacao: 'plu_sync_v1',
      contexto: { aExecutar: plano.resumo.aExecutar }
    });

    this._session.comparacao = comparacao;
    this._session.plano = plano;
    this._status.phase = 'compared';

    if (this._session.syncId != null && opcoes.persistir !== false) {
      await this.repository.atualizarSync(this._session.syncId, {
        status: 'COMPARADO',
        produtos_ignorados: plano.resumo.iguais + plano.resumo.ausentes
      });
    }

    return {
      success: true,
      syncId: this._session.syncId,
      comparacao,
      plano,
      resumo: plano.resumo
    };
  }

  /**
   * Executa sincronização apenas com confirmação do usuário.
   */
  async sync(opcoes = {}) {
    const log = getLogger();
    if (opcoes.confirm !== true) {
      throw SyncError.fromCode(
        CODES.SYNC_NOT_CONFIRMED,
        'Confirme a sincronização (confirm: true). Auto-sync não é permitido.',
        { statusCode: 400 }
      );
    }

    const host = opcoes.host || this._session.host;
    const porta = opcoes.porta != null ? opcoes.porta : this._session.porta;
    const plano = opcoes.plano || this._session.plano;
    if (!plano || !Array.isArray(plano.itens)) {
      throw SyncError.fromCode(CODES.PLAN_INVALID, 'Plano de sincronização ausente. Execute compare antes.', {
        statusCode: 400
      });
    }

    let syncId = this._session.syncId;
    if (opcoes.persistir !== false && syncId == null) {
      syncId = await this.repository.criarSync({ tipo: 'PLU_SYNC', host, porta });
      this._session.syncId = syncId;
      this._session.iniciadoEm = new Date().toISOString();
    }

    this._status = {
      running: true,
      phase: 'sync',
      lidos: this._session.plusBalanca.length,
      total: plano.itens.filter((i) => i.selecionado).length,
      done: 0
    };

    if (syncId != null) {
      await this.repository.atualizarSync(syncId, { status: 'SINCRONIZANDO' });
      for (const item of plano.itens) {
        if (!item.selecionado) continue;
        await this.repository.inserirItem({
          sync_id: syncId,
          produto_id: item.cds && item.cds.produto_id,
          plu: item.plu,
          acao: item.acao,
          status: 'PENDENTE'
        });
      }
    }

    const execucao = await this.executor.execute(plano.itens, {
      host,
      porta,
      confirm: true,
      persistir: opcoes.persistir !== false,
      timeout: opcoes.timeout,
      onProgress: (p) => {
        this._status.done = p.done;
        this._status.total = p.total;
        if (typeof opcoes.onProgress === 'function') opcoes.onProgress(p);
      }
    });

    const enviados = execucao.resultados.filter((r) => r.acao === 'ENVIAR' && r.success).length;
    const atualizados = execucao.resultados.filter((r) => r.acao === 'ATUALIZAR' && r.success).length;
    const falhas = execucao.resultados.filter((r) => !r.success).length;

    const relatorio = report.buildReport({
      syncId,
      comparacao: this._session.comparacao,
      plano,
      execucao,
      iniciadoEm: this._session.iniciadoEm,
      finalizadoEm: new Date().toISOString(),
      produtosLidos: this._session.plusBalanca.length
    });

    await log.info('Relatório gerado', {
      operacao: 'plu_sync_v1',
      contexto: relatorio
    });

    if (syncId != null) {
      await this.repository.atualizarSync(syncId, {
        status: falhas ? 'CONCLUIDO_COM_ERROS' : 'CONCLUIDO',
        produtos_enviados: enviados,
        produtos_atualizados: atualizados,
        produtos_ignorados: relatorio.produtosIgnorados,
        erros: falhas,
        relatorio_json: JSON.stringify(relatorio),
        finalizar: true
      });

      const detalhe = await this.repository.buscarPorId(syncId);
      if (detalhe && detalhe.itens) {
        for (const itemDb of detalhe.itens) {
          const r = execucao.resultados.find((x) => String(x.plu) === String(itemDb.plu));
          if (!r) continue;
          await this.repository.atualizarItem(itemDb.id, {
            status: r.success ? 'OK' : 'ERRO',
            erro: r.error || null
          });
        }
      }
    }

    this._status.running = false;
    this._status.phase = 'done';

    return {
      success: execucao.success,
      syncId,
      execucao,
      relatorio
    };
  }

  async history(filtros) {
    return this.repository.historico(filtros);
  }

  async getById(id) {
    const row = await this.repository.buscarPorId(id);
    if (!row) {
      throw SyncError.fromCode(CODES.NOT_FOUND, 'Sincronização não encontrada', { statusCode: 404 });
    }
    return row;
  }
}

const toledoSyncEngine = new ToledoSyncEngine();

module.exports = toledoSyncEngine;
module.exports.ToledoSyncEngine = ToledoSyncEngine;
module.exports.toledoSyncEngine = toledoSyncEngine;
