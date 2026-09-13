/**
 * Sprint 14.8 — ToledoDownloadEngine
 * Consulta PLUs na balança via Operation Engine → Driver → ConnectionManager.
 */

'use strict';

const frameBuilder = require('../ToledoFrameBuilder');
const { COMMANDS } = require('../ToledoProtocol');
const DownloadPluOperation = require('./DownloadPluOperation');
const { SyncError, CODES } = require('./ToledoSyncErrors');
const { ToledoOperationEngine } = require('../operations/ToledoOperationEngine');
const OperationContext = require('../operations/OperationContext');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[sync-dl-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[sync-dl-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoDownloadEngine {
  constructor(deps = {}) {
    this.operationEngine = deps.operationEngine || null;
    this._cancelled = false;
    this._status = {
      running: false,
      phase: 'idle',
      lidos: 0,
      total: 0,
      mode: null
    };
    this._driverFactory = deps.driverFactory || null;
    this._engineFactory = deps.engineFactory || (() => new ToledoOperationEngine({
      persistir: deps.persistir !== false,
      driverFactory: this._driverFactory,
      drivers: deps.drivers
    }));
  }

  _engine() {
    if (!this.operationEngine) {
      this.operationEngine = this._engineFactory();
    }
    return this.operationEngine;
  }

  status() {
    return { ...this._status, cancelled: this._cancelled };
  }

  cancel() {
    this._cancelled = true;
    return { cancelled: true };
  }

  /**
   * Download completo.
   */
  async downloadAll(opcoes = {}) {
    return this.download({ ...opcoes, range: { all: true } });
  }

  /**
   * Download parcial por faixa de PLU.
   */
  async downloadRange(from, to, opcoes = {}) {
    return this.download({
      ...opcoes,
      range: { from: String(from), to: String(to), all: false }
    });
  }

  /**
   * @param {{host, porta, range?, timeout?, onProgress?}} opcoes
   */
  async download(opcoes = {}) {
    this._cancelled = false;
    const log = getLogger();
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    const range = opcoes.range || { all: true };

    if (!host || !porta) {
      throw SyncError.fromCode(CODES.INVALID_INPUT, 'host e porta obrigatórios', { statusCode: 400 });
    }

    this._status = {
      running: true,
      phase: 'download',
      lidos: 0,
      total: 0,
      mode: range.all ? 'all' : 'range'
    };

    await log.info('Download iniciado', {
      operacao: 'plu_sync_v1',
      contexto: { host, porta, range }
    });

    try {
      if (this._cancelled) {
        throw SyncError.fromCode(CODES.DOWNLOAD_CANCELLED, 'Download cancelado');
      }

      const engine = this._engine();
      const frame = frameBuilder.build(COMMANDS.DOWNLOAD_PLU, range);
      const chave = `${host}:${porta}`;

      const { withBusy, OP_BUSY } = require('../../../connection/SessionBusy');
      const result = await withBusy({ host, porta }, OP_BUSY.DOWNLOAD, () => engine.queue.enqueue(chave, async () => {
        const driver = await engine._ensureDriver(host, porta, opcoes);
        const op = new DownloadPluOperation({
          range,
          frame,
          timeout: opcoes.timeout
        });
        const ctx = new OperationContext({
          host,
          porta,
          driver,
          connection: { host, porta, via: 'ConnectionManager' }
        });
        return op.execute(ctx);
      }));

      if (!result.success) {
        throw SyncError.fromCode(
          CODES.DOWNLOAD_FAILED,
          result.error || 'Falha no download',
          { statusCode: 502 }
        );
      }

      const plus = (result.data && result.data.plus) || [];
      this._status.lidos = plus.length;
      this._status.total = plus.length;

      for (let i = 0; i < plus.length; i += 1) {
        if (this._cancelled) {
          throw SyncError.fromCode(CODES.DOWNLOAD_CANCELLED, 'Download cancelado');
        }
        this._status.lidos = i + 1;
        await log.info('Produto recebido', {
          operacao: 'plu_sync_v1',
          contexto: { plu: plus[i].plu, index: i + 1, total: plus.length }
        });
        if (typeof opcoes.onProgress === 'function') {
          try {
            opcoes.onProgress({
              phase: 'download',
              lidos: i + 1,
              total: plus.length,
              plu: plus[i]
            });
          } catch (_) { /* ignore */ }
        }
      }

      this._status.running = false;
      this._status.phase = 'done';

      return {
        success: true,
        plus,
        total: plus.length,
        range,
        duration: result.duration,
        bytesSent: result.bytesSent,
        bytesReceived: result.bytesReceived
      };
    } catch (err) {
      this._status.running = false;
      this._status.phase = 'error';
      throw err;
    }
  }
}

module.exports = ToledoDownloadEngine;
module.exports.ToledoDownloadEngine = ToledoDownloadEngine;
