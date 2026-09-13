/**
 * Sprint 15.2 / RC14.14.2 — Toledo90AXEngine
 * Pipeline oficial: FrameBuilder → TX → RxBuffer → Parser → Checksum → ACK → Result
 * Uma operação por host:porta; ACK vinculado a Operation ID.
 */

'use strict';

const frameBuilder = require('./ToledoFrameBuilder');
const frameParser = require('./ToledoFrameParser');
const checksum = require('./ToledoChecksum');
const commandRegistry = require('./ToledoCommandRegistry');
const ToledoSession = require('./ToledoSession');
const ToledoRxBuffer = require('./ToledoRxBuffer');
const ToledoAckRouter = require('./ToledoAckRouter');
const OperationQueue = require('../operations/OperationQueue');
const {
  TimeoutError,
  ConnectionLostError,
  InvalidFrameError
} = require('./ToledoProtocolErrors');

const FIRMWARE = '90AX';
const DRIVER = 'TOLEDO_PRIX4_UNO';

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[toledo-90ax]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[toledo-90ax]', msg, ctx || ''),
      warn: async (msg, ctx) => console.warn('[toledo-90ax]', msg, ctx || '')
    };
  }
  return logger;
}

class Toledo90AXEngine {
  /**
   * @param {object} [deps]
   * @param {object} [deps.connectionManager]
   * @param {object} [deps.registry]
   * @param {OperationQueue} [deps.queue]
   * @param {ToledoAckRouter} [deps.ackRouter]
   */
  constructor(deps = {}) {
    this.cm = deps.connectionManager || require('../../../connection/ConnectionManager');
    this.registry = deps.registry || commandRegistry;
    this.queue = deps.queue || new OperationQueue();
    this.ackRouter = deps.ackRouter || new ToledoAckRouter();
    /** @type {Map<string, ToledoRxBuffer>} */
    this._rxBuffers = new Map();
    this.host = null;
    this.porta = null;
    this.equipamentoId = null;
    this._historico = [];
    this._sessaoAtual = null;
    this._ultimo = null;
  }

  bind(alvo = {}) {
    this.host = alvo.host || alvo.ip || this.host;
    this.porta = alvo.porta != null ? Number(alvo.porta) : this.porta;
    this.equipamentoId = alvo.equipamentoId || alvo.equipamento_id || this.equipamentoId;
    return this;
  }

  _alvo() {
    return {
      host: this.host,
      porta: this.porta,
      equipamentoId: this.equipamentoId
    };
  }

  _chave() {
    return `${this.host || ''}:${this.porta || 0}`;
  }

  _rxBuffer() {
    const key = this._chave();
    if (!this._rxBuffers.has(key)) {
      this._rxBuffers.set(key, new ToledoRxBuffer({
        onInvalid: (info) => {
          getLogger().warn?.('Frame RX descartado', {
            operacao: 'toledo_90ax',
            contexto: { ...info, host: this.host, porta: this.porta }
          }).catch?.(() => {});
        }
      }));
    }
    return this._rxBuffers.get(key);
  }

  async _enviar(buf) {
    const alvo = this._alvo();
    if (typeof this.cm.send === 'function') {
      try {
        return await this.cm.send(alvo, buf);
      } catch (err) {
        if (err.code !== 'NOT_CONNECTED') throw err;
      }
    }
    const tcp = this.cm.getTcp?.(alvo);
    if (!tcp || !tcp.aberto) {
      throw new ConnectionLostError('Connection Manager: não conectado');
    }
    return tcp.write(buf);
  }

  async _receberChunk(timeoutMs) {
    const alvo = this._alvo();
    if (typeof this.cm.receive === 'function') {
      try {
        return await this.cm.receive(alvo, { timeoutMs });
      } catch (err) {
        if (err.code !== 'NOT_CONNECTED') throw err;
      }
    }
    const tcp = this.cm.getTcp?.(alvo);
    if (!tcp || !tcp.aberto) {
      throw new ConnectionLostError('Connection Manager: não conectado');
    }
    return tcp.read({ timeoutMs });
  }

  /**
   * RX frame-aware: acumula chunks até STX…ETX + checksum válido.
   */
  async _receberFrame(timeoutMs) {
    const buffer = this._rxBuffer();
    return buffer.waitFrame({
      timeoutMs,
      readChunk: (restante) => this._receberChunk(restante)
    });
  }

  async _labObserve(direction, bytes, meta = {}) {
    try {
      const lab = require('../../../laboratorio/EngineeringLab');
      if (direction === 'TX') await lab.observeTx(bytes, meta);
      else await lab.observeRx(bytes, meta);
    } catch (_) { /* lab nunca bloqueia */ }
  }

  _registrarHistorico(entrada) {
    this._historico.unshift(entrada);
    if (this._historico.length > 200) this._historico.length = 200;
    this._ultimo = entrada;
  }

  _novoOperationId(comando) {
    return `op-${comando}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * API principal — Driver chama engine.execute(command).
   * Serializado por host:porta; ACK amarrado ao operationId.
   */
  async execute(command, payload = null, opcoes = {}) {
    if (opcoes.host || opcoes.porta || opcoes.equipamentoId) {
      this.bind(opcoes);
    }
    const chave = this._chave();
    const operationId = opcoes.operationId || this._novoOperationId(command);

    return this.queue.enqueue(chave, () => this._executeOnce(command, payload, {
      ...opcoes,
      operationId
    }), { operation: { id: operationId } });
  }

  async _executeOnce(command, payload, opcoes = {}) {
    const def = this.registry.obter(command);
    const timeoutMs = opcoes.timeoutMs != null ? opcoes.timeoutMs : def.timeoutMs;
    const retries = opcoes.retries != null ? opcoes.retries : def.retries;
    const operationId = opcoes.operationId || this._novoOperationId(def.name);
    const session = new ToledoSession({ id: operationId, comando: def.name });
    this._sessaoAtual = session;

    const inicioTotal = Date.now();
    let ultimoErro = null;

    for (let tentativa = 0; tentativa <= retries; tentativa += 1) {
      session.tentativa = tentativa + 1;
      session.iniciar(def.name);
      try {
        const bodyPayload = def.buildPayload(payload);
        const tx = frameBuilder.build(def.wireCommand, bodyPayload);
        const chkTx = (() => {
          try {
            return frameParser.parse(tx).checksum;
          } catch (_) {
            return null;
          }
        })();

        session.marcarEnviado(tx);
        await this._labObserve('TX', tx, {
          host: this.host,
          porta: this.porta,
          comando: def.wireCommand,
          operationId,
          driver: DRIVER,
          firmware: FIRMWARE
        });
        await this._enviar(tx);

        await getLogger().info('Frame TX', {
          operacao: 'toledo_90ax',
          contexto: {
            comando: def.name,
            wire: def.wireCommand,
            operationId,
            checksum: chkTx,
            bytes: tx.length,
            tentativa: tentativa + 1
          }
        });

        // ACK exclusivo desta operação
        this.ackRouter.begin(this._chave(), {
          operationId,
          wireCommand: def.wireCommand
        });

        const rx = await this._receberFrame(timeoutMs);
        if (!rx || !rx.length) {
          this.ackRouter.fail(this._chave(), new TimeoutError(`Timeout aguardando resposta de ${def.name}`, {
            comando: def.name,
            timeoutMs,
            operationId
          }));
          session.marcarTimeout();
          throw new TimeoutError(`Timeout aguardando resposta de ${def.name}`, {
            comando: def.name,
            timeoutMs,
            operationId
          });
        }

        session.marcarRecebido(rx);
        await this._labObserve('RX', rx, {
          host: this.host,
          porta: this.porta,
          comando: def.name,
          operationId,
          driver: DRIVER,
          firmware: FIRMWARE
        });

        let parsed;
        try {
          parsed = frameParser.parse(rx);
        } catch (err) {
          this.ackRouter.fail(this._chave(), err);
          session.marcarErro(err);
          throw err;
        }

        const ackResult = this.ackRouter.complete(this._chave(), parsed, rx);
        if (!ackResult || ackResult.operationId !== operationId) {
          throw new InvalidFrameError('ACK não associado à operação', { operationId });
        }

        const match = def.matcher.match(parsed, {
          requestCommand: def.wireCommand,
          payload: bodyPayload,
          operationId
        });
        session.marcarSucesso(parsed);

        const resultado = {
          sucesso: true,
          command: def.name,
          wireCommand: def.wireCommand,
          operationId,
          responseCommand: match.command,
          payload: match.payload,
          checksum: parsed.checksum,
          latenciaMs: session.latenciaMs,
          tentativa: tentativa + 1,
          txHex: tx.toString('hex'),
          rxHex: rx.toString('hex'),
          tx,
          rx,
          parsed,
          session: session.snapshot(),
          firmware: FIRMWARE,
          driver: DRIVER,
          validacao: true,
          tempoTotalMs: Date.now() - inicioTotal
        };

        this._registrarHistorico({
          em: new Date().toISOString(),
          ...resultado,
          tx: undefined,
          rx: undefined,
          parsed: {
            command: parsed.command || parsed.comando,
            payload: parsed.payload,
            checksum: parsed.checksum,
            valid: parsed.valid
          }
        });

        await getLogger().info('Frame RX OK', {
          operacao: 'toledo_90ax',
          contexto: {
            comando: def.name,
            response: match.command,
            operationId,
            checksum: parsed.checksum,
            latenciaMs: session.latenciaMs
          }
        });

        return resultado;
      } catch (err) {
        ultimoErro = err;
        this.ackRouter.clear(this._chave());
        if (err instanceof TimeoutError) {
          session.marcarTimeout();
        } else if (session.estado !== 'ERROR' && session.estado !== 'TIMEOUT') {
          session.marcarErro(err);
        }
        this._registrarHistorico({
          em: new Date().toISOString(),
          sucesso: false,
          command: def.name,
          wireCommand: def.wireCommand,
          operationId,
          erro: { mensagem: err.message, codigo: err.code },
          session: session.snapshot(),
          tentativa: tentativa + 1,
          firmware: FIRMWARE,
          driver: DRIVER
        });
        if (tentativa >= retries) break;
      }
    }

    throw ultimoErro || new InvalidFrameError(`Falha ao executar ${command}`);
  }

  /** Envia frame bruto já montado (lab / engenharia reversa). */
  async executeRaw(buffer, opcoes = {}) {
    if (opcoes.host || opcoes.porta) this.bind(opcoes);
    const chave = this._chave();
    const operationId = opcoes.operationId || this._novoOperationId('raw');
    return this.queue.enqueue(chave, async () => {
      const tx = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [], 'hex');
      const session = new ToledoSession({ id: operationId, comando: 'raw' });
      this._sessaoAtual = session;
      session.iniciar('raw');
      session.marcarEnviado(tx);
      await this._labObserve('TX', tx, { host: this.host, porta: this.porta, comando: 'RAW', operationId });
      await this._enviar(tx);
      const timeoutMs = opcoes.timeoutMs != null ? opcoes.timeoutMs : 1500;
      this.ackRouter.begin(chave, { operationId, wireCommand: 'RAW' });
      const rx = await this._receberFrame(timeoutMs);
      if (!rx || !rx.length) {
        this.ackRouter.fail(chave, new TimeoutError('Timeout em raw', { operationId }));
        session.marcarTimeout();
        throw new TimeoutError('Timeout em raw', { operationId });
      }
      session.marcarRecebido(rx);
      await this._labObserve('RX', rx, { host: this.host, porta: this.porta, comando: 'RAW', operationId });
      let parsed = null;
      try {
        parsed = frameParser.parse(rx);
        const ackResult = this.ackRouter.complete(chave, parsed, rx);
        if (!ackResult || ackResult.operationId !== operationId) {
          throw new InvalidFrameError('ACK raw sem operação', { operationId });
        }
        session.marcarSucesso(parsed);
      } catch (err) {
        this.ackRouter.fail(chave, err);
        session.marcarErro(err);
      }
      const out = {
        sucesso: Boolean(parsed?.valid !== false && parsed),
        command: 'raw',
        operationId,
        checksum: parsed?.checksum || null,
        latenciaMs: session.latenciaMs,
        txHex: tx.toString('hex'),
        rxHex: rx.toString('hex'),
        parsed,
        session: session.snapshot(),
        firmware: FIRMWARE,
        driver: DRIVER
      };
      this._registrarHistorico({ em: new Date().toISOString(), ...out });
      return out;
    }, { operation: { id: operationId } });
  }

  history({ limite = 50 } = {}) {
    return this._historico.slice(0, Math.max(1, Math.min(200, Number(limite) || 50)));
  }

  status() {
    return {
      host: this.host,
      porta: this.porta,
      equipamentoId: this.equipamentoId,
      sessao: this._sessaoAtual ? this._sessaoAtual.snapshot() : null,
      ultimo: this._ultimo,
      comandos: this.registry.listar(),
      fila: this.queue.size(this._chave()),
      ackPendente: this.ackRouter.pendingId(this._chave()),
      rxPendingBytes: this._rxBuffers.get(this._chave())?.pendingBytes || 0,
      firmware: FIRMWARE,
      driver: DRIVER
    };
  }

  // Atalhos
  identify(payload, opcoes) { return this.execute('identify', payload, opcoes); }
  handshake(payload, opcoes) { return this.execute('handshake', payload, opcoes); }
  ping(payload, opcoes) { return this.execute('ping', payload, opcoes); }
  getStatus(payload, opcoes) { return this.execute('status', payload, opcoes); }
  uploadPlu(payload, opcoes) { return this.execute('uploadPlu', payload, opcoes); }
  downloadPlu(payload, opcoes) { return this.execute('downloadPlu', payload, opcoes); }
  readWeight(payload, opcoes) { return this.execute('readWeight', payload, opcoes); }
  configRead(payload, opcoes) { return this.execute('configRead', payload, opcoes); }
  configWrite(payload, opcoes) { return this.execute('configWrite', payload, opcoes); }
}

const engineSingleton = new Toledo90AXEngine();

module.exports = engineSingleton;
module.exports.Toledo90AXEngine = Toledo90AXEngine;
module.exports.createEngine = (deps) => new Toledo90AXEngine(deps);
module.exports.frameBuilder = frameBuilder;
module.exports.frameParser = frameParser;
module.exports.checksum = checksum;
module.exports.FIRMWARE = FIRMWARE;
module.exports.DRIVER = DRIVER;
