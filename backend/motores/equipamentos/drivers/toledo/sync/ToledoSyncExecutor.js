/**
 * Sprint 14.8 / 15.4 — ToledoSyncExecutor
 * V1: plano aprovado via ToledoPluEngine.
 * V15.4: lotes via Toledo90AXEngine + RetryPolicy + Validator.
 */

'use strict';

const { ACAO } = require('./ToledoSyncPlanner');
const { SyncError, CODES } = require('./ToledoSyncErrors');
const { ToledoPluEngine } = require('../plu/ToledoPluEngine');
const batchBuilder = require('./ToledoBatchBuilder');
const ToledoRetryPolicy = require('./ToledoRetryPolicy');
const validator = require('./ToledoSyncValidator');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[sync-ex]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[sync-ex]', msg, ctx || ''),
      warn: async (msg, ctx) => console.warn('[sync-ex]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoSyncExecutor {
  /**
   * @param {object} [deps]
   * @param {object} [deps.engine] — Toledo90AXEngine (ou createEngine)
   * @param {object} [deps.pluEngine] — legado V1
   * @param {object} [deps.retryPolicy]
   */
  constructor(deps = {}) {
    this.engine = deps.engine || null;
    this.pluEngine = deps.pluEngine || null;
    if (!this.engine && !this.pluEngine) {
      this.pluEngine = new ToledoPluEngine({
        persistir: deps.persistir !== false,
        driverFactory: deps.driverFactory,
        drivers: deps.drivers,
        operationEngine: deps.operationEngine
      });
    }
    this.retryPolicy = deps.retryPolicy || new ToledoRetryPolicy({ maxAttempts: 3 });
    this._cancelled = false;
    this._confirmedLotes = new Set();
    this._status = {
      running: false,
      done: 0,
      total: 0,
      ok: 0,
      erro: 0
    };
  }

  status() {
    return { ...this._status, cancelled: this._cancelled };
  }

  cancel() {
    this._cancelled = true;
    if (this.pluEngine && typeof this.pluEngine.cancel === 'function') {
      this.pluEngine.cancel();
    }
    return { cancelled: true };
  }

  /**
   * V1 — executa plano item a item (PluEngine).
   * @param {Array} itens plano.itens
   * @param {{host, porta, confirm, onProgress, persistir}} opcoes
   */
  async execute(itens, opcoes = {}) {
    if (opcoes.confirm !== true) {
      throw SyncError.fromCode(
        CODES.SYNC_NOT_CONFIRMED,
        'Sincronização exige confirmação explícita do usuário (confirm: true)',
        { statusCode: 400 }
      );
    }

    // Preferência 90AX quando engine disponível e não forçado legado
    if (this.engine && opcoes.legacy !== true) {
      const carga = {
        plus: (Array.isArray(itens) ? itens : [])
          .filter((i) => i && (i.selecionado === true || i.acao === ACAO.ENVIAR || i.acao === ACAO.ATUALIZAR)
            && (i.acao === ACAO.ENVIAR || i.acao === ACAO.ATUALIZAR))
          .map((i) => ({ ...(i.cds || i.produto || {}), _acao: i.acao, plu: i.plu }))
      };
      return this.executeBatches(carga, opcoes);
    }

    return this._executeLegacy(itens, opcoes);
  }

  async _executeLegacy(itens, opcoes = {}) {
    this._cancelled = false;
    const log = getLogger();
    const lista = (Array.isArray(itens) ? itens : [])
      .filter((i) => i && (i.selecionado === true || i.acao === ACAO.ENVIAR || i.acao === ACAO.ATUALIZAR)
        && (i.acao === ACAO.ENVIAR || i.acao === ACAO.ATUALIZAR));

    const inicio = Date.now();
    this._status = {
      running: true,
      done: 0,
      total: lista.length,
      ok: 0,
      erro: 0
    };

    await log.info('Sincronização executada', {
      operacao: 'plu_sync_v1',
      contexto: { total: lista.length, host: opcoes.host, porta: opcoes.porta }
    });

    const resultados = [];

    for (const item of lista) {
      if (this._cancelled) {
        throw SyncError.fromCode(CODES.SYNC_CANCELLED, 'Sincronização cancelada');
      }

      const produto = item.cds || item.produto;
      if (!produto) {
        resultados.push({
          success: false,
          plu: item.plu,
          acao: item.acao,
          error: 'Produto CDS ausente para envio'
        });
        this._status.erro += 1;
        this._status.done += 1;
        continue;
      }

      try {
        const r = await this.pluEngine.upload(produto, {
          host: opcoes.host,
          porta: opcoes.porta,
          persistir: opcoes.persistir !== false,
          timeout: opcoes.timeout,
          _batch: true
        });
        resultados.push({
          success: true,
          plu: item.plu,
          acao: item.acao,
          syncId: r.syncId
        });
        this._status.ok += 1;
      } catch (err) {
        resultados.push({
          success: false,
          plu: item.plu,
          acao: item.acao,
          error: err.code || err.message
        });
        this._status.erro += 1;
      }

      this._status.done += 1;
      if (typeof opcoes.onProgress === 'function') {
        try {
          opcoes.onProgress({ ...this._status, current: item.plu });
        } catch (_) { /* ignore */ }
      }
    }

    this._status.running = false;
    return {
      success: this._status.erro === 0 && !this._cancelled,
      resultados,
      ok: this._status.ok,
      erro: this._status.erro,
      total: lista.length,
      durationMs: Date.now() - inicio,
      cancelled: this._cancelled
    };
  }

  /**
   * V15.4 — executa lotes via Motor 90AX.
   * @param {object} carga — { plus, departamentos, precos, etiquetas, ... } ou Array de lotes
   * @param {object} opcoes
   */
  async executeBatches(carga, opcoes = {}) {
    if (!this.engine) {
      throw SyncError.fromCode(CODES.SYNC_FAILED, 'Toledo90AXEngine não configurado no Executor', {
        statusCode: 500
      });
    }
    if (opcoes.confirm !== true) {
      throw SyncError.fromCode(
        CODES.SYNC_NOT_CONFIRMED,
        'Sincronização exige confirmação explícita (confirm: true)',
        { statusCode: 400 }
      );
    }

    this._cancelled = false;
    const log = getLogger();
    const inicio = Date.now();
    const lotes = Array.isArray(carga)
      ? carga
      : batchBuilder.buildFromCarga(carga, { tamanhoLote: opcoes.tamanhoLote || 10 });

    const totalItens = lotes.reduce((acc, l) => acc + (l.quantidade || (l.itens || []).length), 0);
    this._status = { running: true, done: 0, total: totalItens, ok: 0, erro: 0 };

    if (opcoes.host || opcoes.porta || opcoes.equipamentoId) {
      this.engine.bind({
        host: opcoes.host,
        porta: opcoes.porta,
        equipamentoId: opcoes.equipamentoId
      });
    }

    await log.info('Sincronização 90AX — lotes', {
      operacao: 'toledo_sync_v15',
      contexto: {
        lotes: lotes.length,
        itens: totalItens,
        host: opcoes.host,
        porta: opcoes.porta
      }
    });

    const resultados = [];
    const avisos = [];
    const progress = opcoes.progress || null;

    for (let li = 0; li < lotes.length; li += 1) {
      const lote = lotes[li];
      if (this._cancelled) {
        throw SyncError.fromCode(CODES.SYNC_CANCELLED, 'Sincronização cancelada');
      }

      // Nunca reenviar lotes já confirmados
      if (lote.confirmed || this._confirmedLotes.has(lote.id)) {
        lote.confirmed = true;
        continue;
      }

      if (progress) progress.setLote(lote, li + 1);
      if (typeof opcoes.onLote === 'function') {
        try { opcoes.onLote(lote, li); } catch (_) { /* ignore */ }
      }

      const loteInicio = Date.now();
      let loteOk = true;

      for (const item of lote.itens || []) {
        if (this._cancelled) {
          throw SyncError.fromCode(CODES.SYNC_CANCELLED, 'Sincronização cancelada');
        }

        const vItem = validator.validarItemCarga(item, lote.tipo);
        if (!vItem.ok) {
          resultados.push({
            success: false,
            plu: item.plu,
            tipo: lote.tipo,
            loteId: lote.id,
            acao: item._acao || ACAO.ENVIAR,
            error: vItem.erro
          });
          this._status.erro += 1;
          this._status.done += 1;
          loteOk = false;
          if (progress) progress.markItem(false);
          continue;
        }

        if (progress) progress.setProduto(item);

        const retryResult = await this.retryPolicy.execute(
          async ({ attempt }) => {
            await log.info('Frame TX sync', {
              operacao: 'toledo_sync_v15',
              contexto: {
                comando: lote.comando,
                plu: item.plu,
                lote: lote.id,
                attempt
              }
            });
            const raw = await this.engine.execute(lote.comando, item, {
              host: opcoes.host,
              porta: opcoes.porta,
              equipamentoId: opcoes.equipamentoId,
              timeoutMs: opcoes.timeoutMs || opcoes.timeout,
              retries: 0 // retry no nível de sync
            });
            return raw;
          },
          {
            alreadyConfirmed: false,
            isAbort: () => this._cancelled,
            isSuccess: (r) => {
              const v = validator.validarResposta(r, { lote, esperado: 1 });
              return v.ok;
            },
            onRetry: (info) => {
              log.warn('Retry sync', {
                operacao: 'toledo_sync_v15',
                contexto: { plu: item.plu, lote: lote.id, ...info, error: info.error?.message }
              }).catch(() => {});
              if (typeof opcoes.onRetry === 'function') opcoes.onRetry({ ...info, item, lote });
            }
          }
        );

        if (retryResult.success) {
          const v = validator.validarResposta(retryResult.result, { lote });
          if (v.avisos?.length) avisos.push(...v.avisos);
          resultados.push({
            success: true,
            plu: item.plu,
            tipo: lote.tipo,
            loteId: lote.id,
            acao: item._acao || ACAO.ENVIAR,
            checksum: v.checksum,
            attempts: retryResult.attempts,
            txHex: v.txHex,
            rxHex: v.rxHex,
            latenciaMs: v.latenciaMs
          });
          this._status.ok += 1;
          if (progress) progress.markItem(true);
        } else {
          loteOk = false;
          resultados.push({
            success: false,
            plu: item.plu,
            tipo: lote.tipo,
            loteId: lote.id,
            acao: item._acao || ACAO.ENVIAR,
            error: retryResult.error?.message || retryResult.error?.code || 'Falha após retries',
            attempts: retryResult.attempts
          });
          this._status.erro += 1;
          if (progress) progress.markItem(false);
          if (progress) progress.fail(retryResult.error);
        }

        this._status.done += 1;
        if (typeof opcoes.onProgress === 'function') {
          try {
            opcoes.onProgress({
              ...this._status,
              current: item.plu,
              lote: lote.id,
              progress: progress ? progress.snapshot() : null
            });
          } catch (_) { /* ignore */ }
        }
      }

      lote.tempo = Date.now() - loteInicio;
      if (loteOk) {
        lote.confirmed = true;
        this._confirmedLotes.add(lote.id);
      } else {
        lote.failed = true;
      }
    }

    this._status.running = false;
    return {
      success: this._status.erro === 0 && !this._cancelled,
      resultados,
      ok: this._status.ok,
      erro: this._status.erro,
      total: totalItens,
      durationMs: Date.now() - inicio,
      cancelled: this._cancelled,
      lotes: lotes.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        quantidade: l.quantidade,
        checksum: l.checksum,
        tempo: l.tempo,
        confirmed: !!l.confirmed,
        failed: !!l.failed
      })),
      avisos
    };
  }
}

module.exports = ToledoSyncExecutor;
module.exports.ToledoSyncExecutor = ToledoSyncExecutor;
