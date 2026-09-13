/**
 * Sprint 14.9 — ToledoWeightEngine
 * Leitura única de peso: Weight → Operation Engine → Driver → ConnectionManager.
 */

'use strict';

const ToledoWeightOperation = require('./ToledoWeightOperation');
const ToledoWeightRepository = require('./ToledoWeightRepository');
const { ToledoWeightEvents } = require('./ToledoWeightEvents');
const { WeightError, CODES } = require('./ToledoWeightErrors');
const { ToledoOperationEngine } = require('../operations/ToledoOperationEngine');
const OperationContext = require('../operations/OperationContext');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[weight-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[weight-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoWeightEngine {
  constructor(deps = {}) {
    this.operationEngine = deps.operationEngine || null;
    this.repository = deps.repository || new ToledoWeightRepository();
    this.events = deps.events || new ToledoWeightEvents();
    this._cancelled = false;
    this._status = {
      running: false,
      last: null,
      phase: 'idle'
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
   * Alias de readOnce — leitura única.
   */
  async read(opcoes = {}) {
    return this.readOnce(opcoes);
  }

  /**
   * Solicita uma leitura única de peso.
   */
  async readOnce(opcoes = {}) {
    this._cancelled = false;
    const log = getLogger();
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    const equipamentoId = opcoes.equipamento_id != null
      ? opcoes.equipamento_id
      : opcoes.equipamentoId;

    if (!host || !porta) {
      throw WeightError.fromCode(CODES.INVALID_INPUT, 'host e porta obrigatórios', {
        statusCode: 400
      });
    }

    this._status = { running: true, last: this._status.last, phase: 'reading' };
    this.events.emitRequested({ host, porta, equipamento_id: equipamentoId });

    await log.info('Solicitação', {
      operacao: 'weight_v1',
      contexto: { host, porta, equipamento_id: equipamentoId }
    });

    const inicio = Date.now();

    try {
      if (this._cancelled) {
        throw WeightError.fromCode(CODES.CANCELLED, 'Leitura de peso cancelada');
      }

      const engine = this._engine();
      const chave = `${host}:${porta}`;

      await log.info('Frame enviado', {
        operacao: 'weight_v1',
        contexto: { comando: 'PW', host, porta }
      });

      const result = await engine.queue.enqueue(chave, async () => {
        const driver = await engine._ensureDriver(host, porta, opcoes);
        const op = new ToledoWeightOperation({ timeout: opcoes.timeout });
        const ctx = new OperationContext({
          host,
          porta,
          driver,
          connection: { host, porta, via: 'ConnectionManager' }
        });
        return op.execute(ctx);
      });

      const durationMs = result.duration != null ? result.duration : (Date.now() - inicio);

      if (!result.success) {
        const isTimeout = result.error === CODES.WEIGHT_TIMEOUT
          || result.status === 'ERROR' && String(result.error || '').toLowerCase().includes('timeout');
        if (isTimeout || result.error === 'TIMEOUT') {
          this.events.emitTimeout({ host, porta, error: result.error });
          throw WeightError.fromCode(CODES.WEIGHT_TIMEOUT, result.error || 'Timeout', {
            statusCode: 408
          });
        }
        throw WeightError.fromCode(
          result.error || CODES.READ_ERROR,
          result.error || 'Falha na leitura de peso',
          { statusCode: 502 }
        );
      }

      const data = result.data || {};
      const weightResult = {
        success: true,
        peso: data.peso,
        unidade: data.unidade || 'kg',
        estabilidade: data.estabilidade === true || data.estavel === true,
        estavel: data.estabilidade === true || data.estavel === true,
        duracao_ms: durationMs,
        host,
        porta,
        equipamento_id: equipamentoId || null,
        lido_em: new Date().toISOString()
      };

      await log.info('Peso recebido', {
        operacao: 'weight_v1',
        contexto: { peso: weightResult.peso, unidade: weightResult.unidade }
      });
      await log.info('Peso validado', {
        operacao: 'weight_v1',
        contexto: { estabilidade: weightResult.estabilidade }
      });

      this.events.emitReceived(weightResult);
      this.events.emitUpdated(weightResult);

      let id = null;
      if (opcoes.persistir !== false) {
        id = await this.repository.registrar({
          equipamento_id: equipamentoId,
          peso: weightResult.peso,
          unidade: weightResult.unidade,
          estavel: weightResult.estavel,
          duracao_ms: durationMs,
          host,
          porta
        });
      }

      this._status = {
        running: false,
        phase: 'done',
        last: { ...weightResult, id }
      };

      await log.info('Retornado ao PDV', {
        operacao: 'weight_v1',
        contexto: { id, peso: weightResult.peso }
      });

      return { ...weightResult, id };
    } catch (err) {
      this._status = { running: false, phase: 'error', last: this._status.last };
      this.events.emitError(err, { host, porta });

      if (opcoes.persistir !== false) {
        try {
          await this.repository.registrar({
            equipamento_id: equipamentoId,
            peso: null,
            unidade: 'kg',
            estavel: false,
            duracao_ms: Date.now() - inicio,
            host,
            porta,
            erro: err.message || err.code
          });
        } catch (_) { /* ignore */ }
      }
      throw err;
    }
  }

  async history(filtros) {
    return this.repository.historico(filtros);
  }
}

const toledoWeightEngine = new ToledoWeightEngine();

module.exports = toledoWeightEngine;
module.exports.ToledoWeightEngine = ToledoWeightEngine;
module.exports.toledoWeightEngine = toledoWeightEngine;
