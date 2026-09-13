/**
 * Sprint 14.6 — ToledoOperationEngine
 * Executa operações via Driver — nunca TcpConnection direto.
 */

'use strict';

const OperationContext = require('./OperationContext');
const OperationQueue = require('./OperationQueue');
const OperationRepository = require('./OperationRepository');
const OperationResult = require('./OperationResult');
const { OperationError, CODES } = require('./OperationErrors');
const { PingOperation, HandshakeOperation, IdentifyOperation } = require('./operations');
const UploadPluOperation = require('../plu/UploadPluOperation');
const DownloadPluOperation = require('../sync/DownloadPluOperation');
const ToledoWeightOperation = require('../weight/ToledoWeightOperation');
const ToledoConfigurationOperation = require('../configuration/ToledoConfigurationOperation');
const ToledoPrixIVDriver = require('../ToledoPrixIVDriver');
const { DRIVER } = require('../ToledoProtocol');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[ops-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[ops-v1]', msg, ctx || '')
    };
  }
  return logger;
}

const OPERACOES = Object.freeze({
  PING: PingOperation,
  HANDSHAKE: HandshakeOperation,
  IDENTIFY: IdentifyOperation,
  UPLOAD_PLU: UploadPluOperation,
  DOWNLOAD_PLU: DownloadPluOperation,
  READ_WEIGHT: ToledoWeightOperation,
  CONFIG_READ: ToledoConfigurationOperation,
  CONFIG_WRITE: ToledoConfigurationOperation
});

class ToledoOperationEngine {
  constructor(deps = {}) {
    this.queue = deps.queue || new OperationQueue();
    this.repository = deps.repository || new OperationRepository();
    this.driverFactory = deps.driverFactory || ((host, porta) => {
      const d = new ToledoPrixIVDriver(deps.driverDeps || {});
      d.host = host;
      d.porta = porta;
      return d;
    });
    /** @type {Map<string, ToledoPrixIVDriver>} */
    this._drivers = deps.drivers || new Map();
    /** @type {Map<string, object>} */
    this._running = new Map();
    this._persistir = deps.persistir !== false;
  }

  _chave(host, porta) {
    return `${host}:${porta}`;
  }

  _getDriver(host, porta) {
    const key = this._chave(host, porta);
    if (!this._drivers.has(key)) {
      this._drivers.set(key, this.driverFactory(host, Number(porta)));
    }
    return this._drivers.get(key);
  }

  /**
   * Garante Driver conectado via ConnectionManager (interno ao Driver).
   */
  async _ensureDriver(host, porta, opcoes = {}) {
    const driver = this._getDriver(host, porta);
    const equipamentoId = opcoes.equipamentoId ?? opcoes.equipamento_id ?? null;
    if (equipamentoId != null && driver) {
      driver.equipamentoId = Number(equipamentoId);
    }
    // RC15.7 — auditoria (sem alterar fluxo)
    let pipelineAudit = null;
    try { pipelineAudit = require('../plu/UploadPipelineAudit'); } catch (_) { /* ignore */ }

    if (!driver.isOnline || !driver.isOnline()) {
      if (pipelineAudit && pipelineAudit.atual()) {
        pipelineAudit.marcar('CONNECT', 'EXECUTANDO', { solicitante: pipelineAudit.SOLICITANTES.OPERATION_ENGINE });
        // Driver.connect sempre dispara handshake após TCP
        pipelineAudit.handshakeSolicitado(pipelineAudit.SOLICITANTES.OPERATION_ENGINE, {
          via: 'ToledoOperationEngine._ensureDriver → driver.connect'
        });
      }
      try {
        await driver.connect({
          host,
          porta,
          equipamentoId: equipamentoId != null ? Number(equipamentoId) : undefined,
          persistir: opcoes.persistir !== false,
          timeoutMs: opcoes.timeoutMs,
          handshakeTimeoutMs: opcoes.handshakeTimeoutMs
        });
        if (pipelineAudit && pipelineAudit.atual() && pipelineAudit.atual().connect === 'EXECUTANDO') {
          pipelineAudit.marcar('CONNECT', 'OK');
        }
      } catch (err) {
        if (pipelineAudit && pipelineAudit.atual()) {
          const ctx = pipelineAudit.atual();
          // Não sobrescrever CONNECT=OK se a falha foi no handshake pós-TCP
          if (ctx.connect === 'EXECUTANDO') {
            pipelineAudit.marcar('CONNECT', 'FALHOU', { motivo: err.message || err.code });
          }
          if (/handshake|timeout/i.test(String(err.message || err.code || ''))) {
            pipelineAudit.handshakeResultado(false, err.message || err.code);
          }
        }
        throw err;
      }
    } else if (pipelineAudit && pipelineAudit.atual()) {
      pipelineAudit.marcar('CONNECT', 'REUTILIZADO');
      pipelineAudit.marcar('HANDSHAKE', 'NÃO EXECUTADO');
    }
    return driver;
  }

  criarOperacao(nome, opcoes = {}) {
    const key = String(nome || '').toUpperCase();
    const Cls = OPERACOES[key];
    if (!Cls) {
      throw OperationError.fromCode(CODES.UNSUPPORTED_OPERATION, `Operação não suportada: ${nome}`, {
        statusCode: 400
      });
    }
    if (key === 'CONFIG_WRITE' || key === 'CONFIG_READ') {
      return new Cls({ ...opcoes, mode: key === 'CONFIG_WRITE' ? 'write' : 'read', operation: key });
    }
    return new Cls(opcoes);
  }

  /**
   * @param {string} nome PING|HANDSHAKE|IDENTIFY
   * @param {{host:string, porta:number, timeout?:number, persistir?:boolean}} opcoes
   */
  async execute(nome, opcoes = {}) {
    const host = String(opcoes.host || opcoes.ip || '');
    const porta = Number(opcoes.porta || opcoes.porta_tcp || 0);
    if (!host || !porta) {
      throw OperationError.fromCode(CODES.INVALID_INPUT, 'host e porta são obrigatórios', {
        statusCode: 400
      });
    }

    const operation = this.criarOperacao(nome, {
      timeout: opcoes.timeout,
      retries: opcoes.retries
    });

    const log = getLogger();
    await log.info('Operação criada', {
      operacao: 'toledo_operations_v1',
      contexto: { id: operation.id, operation: operation.operation, host, porta }
    });

    operation.status = 'QUEUED';
    const chave = this._chave(host, porta);

    await log.info('Fila', {
      operacao: 'toledo_operations_v1',
      contexto: { id: operation.id, queueSize: this.queue.size(chave) }
    });

    const { mapOperacaoParaBusy, withBusy } = require('../../../connection/SessionBusy');
    const busyReason = mapOperacaoParaBusy(nome);
    const alvoBusy = {
      host,
      porta,
      equipamentoId: opcoes.equipamentoId ?? opcoes.equipamento_id ?? null
    };

    const runOp = async () => {
      const result = await this.queue.enqueue(chave, async () => {
        this._running.set(operation.id, operation);
        try {
          await log.info('Executando', {
            operacao: 'toledo_operations_v1',
            contexto: { id: operation.id, operation: operation.operation }
          });

          const driver = await this._ensureDriver(host, porta, opcoes);
          const ctx = new OperationContext({
            host,
            porta,
            driver,
            driverCode: DRIVER,
            session: opcoes.session || null,
            connection: { host, porta, via: 'ConnectionManager' }
          });

          const opResult = await operation.execute(ctx);

          await log.info('Resposta', {
            operacao: 'toledo_operations_v1',
            contexto: {
              id: operation.id,
              success: opResult.success,
              duration: opResult.duration
            }
          });

          if (this._persistir && opcoes.persistir !== false) {
            try {
              await this.repository.salvar(opResult, {
                id: operation.id,
                operation: operation.operation,
                startedAt: operation.startedAt,
                finishedAt: operation.finishedAt,
                host,
                porta
              });
            } catch (_) { /* não bloqueia */ }
          }

          await log.info('Finalizada', {
            operacao: 'toledo_operations_v1',
            contexto: { id: operation.id, status: opResult.status }
          });

          return opResult;
        } finally {
          this._running.delete(operation.id);
        }
      }, { operation });
      return result;
    };

    // RC15.10 — UPLOAD/DOWNLOAD/CONFIG suspendem heartbeat
    const result = busyReason
      ? await withBusy(alvoBusy, busyReason, runOp)
      : await runOp();

    return result instanceof OperationResult ? result : new OperationResult(result);
  }

  cancel(operationId, { host, porta } = {}) {
    const running = this._running.get(operationId);
    if (running) {
      running.cancel();
      return { cancelled: true, id: operationId };
    }
    if (host && porta) {
      const n = this.queue.cancelPending(this._chave(host, porta), operationId);
      return { cancelled: n > 0, id: operationId, pending: n };
    }
    return { cancelled: false, id: operationId };
  }

  status({ host, porta } = {}) {
    if (host && porta) {
      const chave = this._chave(host, porta);
      return {
        busy: this.queue.isBusy(chave),
        queueSize: this.queue.size(chave),
        running: [...this._running.values()]
          .filter((o) => true)
          .map((o) => o.snapshot())
      };
    }
    return {
      running: [...this._running.values()].map((o) => o.snapshot()),
      queues: this.queue._filas.size
    };
  }

  async history(filtros = {}) {
    return this.repository.historico(filtros);
  }

  queue(host, porta) {
    return {
      size: this.queue.size(this._chave(host, porta)),
      busy: this.queue.isBusy(this._chave(host, porta))
    };
  }

  async ping(opcoes) {
    return this.execute('PING', opcoes);
  }

  async handshake(opcoes) {
    return this.execute('HANDSHAKE', opcoes);
  }

  async identify(opcoes) {
    return this.execute('IDENTIFY', opcoes);
  }
}

const toledoOperationEngine = new ToledoOperationEngine();

module.exports = toledoOperationEngine;
module.exports.ToledoOperationEngine = ToledoOperationEngine;
module.exports.OPERACOES = OPERACOES;
