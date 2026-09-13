/**
 * Sprint 14.4 — ToledoPrixIVDriver
 * Comunicação lógica via ConnectionManager. Nunca abre socket.
 */

'use strict';

const connectionManager = require('../../connection/ConnectionManager');
const ToledoHandshake = require('./ToledoHandshake');
const frameBuilder = require('./ToledoFrameBuilder');
const frameParser = require('./ToledoFrameParser');
const { getCapabilities } = require('./ToledoCapabilities');
const {
  DRIVER, FABRICANTE, MODELO, LIMITS, PORTA_PADRAO
} = require('./ToledoProtocol');
const { ToledoError, CODES } = require('./ToledoErrors');
const { createEngine } = require('./protocol/Toledo90AXEngine');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[toledo-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[toledo-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoPrixIVDriver {
  /**
   * @param {object} [deps]
   * @param {object} [deps.connectionManager]
   * @param {object} [deps.engine]
   */
  constructor(deps = {}) {
    this.cm = deps.connectionManager || connectionManager;
    this.engine = deps.engine || createEngine({ connectionManager: this.cm });
    this.host = null;
    this.porta = null;
    this.status = 'OFFLINE';
    this.handshakeOk = false;
    this.latencia = null;
    this._online = false;
  }

  /**
   * Sprint 15.2 — executa comando via Motor 90AX (sem montar bytes no Driver).
   */
  async execute(command, payload = null, opcoes = {}) {
    this.engine.bind({ host: this.host, porta: this.porta, ...opcoes });
    return this.engine.execute(command, payload, {
      host: this.host,
      porta: this.porta,
      ...opcoes
    });
  }

  getCapabilities() {
    return getCapabilities();
  }

  _alvo() {
    if (!this.host || !this.porta) {
      throw ToledoError.fromCode(CODES.NOT_CONNECTED, 'Driver sem host/porta', { statusCode: 400 });
    }
    // RC15.6 — mesmo alvo do Diagnóstico / ConnectionManager
    const alvo = { host: this.host, porta: this.porta };
    if (this.equipamentoId != null) alvo.equipamentoId = Number(this.equipamentoId);
    return alvo;
  }

  _tcp() {
    const tcp = this.cm.getTcp(this._alvo());
    if (!tcp || !tcp.aberto) {
      throw ToledoError.fromCode(CODES.DEVICE_OFFLINE, 'Equipamento offline / sem conexão TCP', {
        statusCode: 503
      });
    }
    return tcp;
  }

  /**
   * Envia frame via ConnectionManager → TcpConnection.write
   * Observação passiva pelo EngineeringLab (não altera bytes).
   */
  async sendFrame(buffer) {
    const tcp = this._tcp();
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    tcp.write(buf);
    try {
      const lab = require('../../laboratorio/EngineeringLab');
      await lab.observeTx(buf, { host: this.host, porta: this.porta });
    } catch (_) { /* lab nunca bloqueia o Driver */ }
    return buf.length;
  }

  /**
   * Recebe frame via TcpConnection.read (sem parser de peso).
   * Observação passiva pelo EngineeringLab.
   */
  async receiveFrame({ timeoutMs } = {}) {
    const tcp = this._tcp();
    const raw = await tcp.read({
      timeoutMs: timeoutMs != null ? timeoutMs : LIMITS.readTimeoutMs
    });
    if (raw && raw.length) {
      try {
        const lab = require('../../laboratorio/EngineeringLab');
        await lab.observeRx(raw, { host: this.host, porta: this.porta });
      } catch (_) { /* lab nunca bloqueia o Driver */ }
    }
    return raw;
  }

  async handshake(opcoes = {}) {
    const log = getLogger();
    await log.info('Handshake enviado', {
      operacao: 'toledo_driver_v1',
      contexto: this._alvo()
    });

    // Sprint 15.2 — preferência Motor 90AX
    try {
      this.engine.bind(this._alvo());
      const result = await this.engine.execute('handshake', null, {
        ...this._alvo(),
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : LIMITS.handshakeTimeoutMs
      });
      this.handshakeOk = true;
      this.latencia = result.latenciaMs;
      this.status = 'ONLINE';
      this._online = true;
      await log.info('Handshake validado (90AX)', {
        operacao: 'toledo_driver_v1',
        contexto: { ...this._alvo(), latencia: result.latenciaMs, checksum: result.checksum }
      });
      return {
        ok: true,
        latencia: result.latenciaMs,
        frame: result.parsed,
        engine: '90AX',
        checksum: result.checksum
      };
    } catch (err90) {
      // Fallback legado (compat testes sem ACK 90AX)
      try {
        const result = await ToledoHandshake.executar({
          sendFrame: (f) => this.sendFrame(f),
          receiveFrame: (o) => this.receiveFrame(o)
        }, opcoes);
        this.handshakeOk = true;
        this.latencia = result.latencia;
        this.status = 'ONLINE';
        this._online = true;
        return { ...result, engine: 'legacy-fallback', erro90ax: err90.message };
      } catch (_) {
        throw err90;
      }
    }
  }

  async ping(opcoes = {}) {
    try {
      this.engine.bind(this._alvo());
      const result = await this.engine.execute('ping', null, {
        ...this._alvo(),
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : LIMITS.pingTimeoutMs
      });
      return { ok: true, frame: result.parsed, engine: '90AX', checksum: result.checksum, latenciaMs: result.latenciaMs };
    } catch (err90) {
      const frame = frameBuilder.buildPing();
      await this.sendFrame(frame);
      const raw = await this.receiveFrame({
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : LIMITS.pingTimeoutMs
      });
      if (!raw) {
        throw ToledoError.fromCode(CODES.CONNECTION_TIMEOUT, 'Timeout no ping', { statusCode: 408 });
      }
      const parsed = frameParser.parse(raw);
      if (!parsed.isAck) {
        throw ToledoError.fromCode(CODES.INVALID_RESPONSE, `Ping sem ACK: ${parsed.comando}`);
      }
      return { ok: true, frame: parsed, engine: 'legacy-fallback' };
    }
  }

  /**
   * Conecta via ConnectionManager + handshake.
   * @param {{host:string, porta?:number, timeoutMs?:number, persistir?:boolean}} opcoes
   */
  async connect(opcoes = {}) {
    const log = getLogger();
    const host = String(opcoes.host || opcoes.ip || '');
    const porta = Number(opcoes.porta || opcoes.porta_tcp || PORTA_PADRAO);

    if (!host || !porta) {
      throw ToledoError.fromCode(CODES.DRIVER_ERROR, 'host e porta obrigatórios', { statusCode: 400 });
    }

    this.host = host;
    this.porta = porta;
    if (opcoes.equipamentoId != null || opcoes.equipamento_id != null) {
      this.equipamentoId = Number(opcoes.equipamentoId ?? opcoes.equipamento_id);
    }
    this.handshakeOk = false;
    this._online = false;
    this.status = 'CONNECTING';

    await log.info('Driver iniciado', {
      operacao: 'toledo_driver_v1',
      contexto: { host, porta, equipamentoId: this.equipamentoId, driver: DRIVER }
    });
    await log.info('ConnectionManager solicitado', {
      operacao: 'toledo_driver_v1',
      contexto: { host, porta, equipamentoId: this.equipamentoId }
    });

    // RC15.7 — auditoria do pipeline (somente se houver contexto de Upload PLU)
    let pipelineAudit = null;
    try { pipelineAudit = require('./plu/UploadPipelineAudit'); } catch (_) { /* ignore */ }
    const auditAtivo = Boolean(pipelineAudit && pipelineAudit.atual());

    let conn;
    try {
      if (auditAtivo) {
        pipelineAudit.marcar('CONNECT', 'EXECUTANDO', {
          solicitante: pipelineAudit.SOLICITANTES.CONNECTION_MANAGER
        });
      }
      conn = await this.cm.connect({
        host,
        porta,
        equipamentoId: this.equipamentoId,
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : LIMITS.connectTimeoutMs,
        persistir: opcoes.persistir !== false
      });
      if (auditAtivo) {
        pipelineAudit.marcar('CONNECT', conn.reutilizada ? 'REUTILIZADO' : 'OK');
      }
    } catch (err) {
      this.status = 'OFFLINE';
      if (auditAtivo) {
        pipelineAudit.marcar('CONNECT', 'FALHOU', { motivo: err.message || err.code });
      }
      if (err.code === 'TCP_TIMEOUT' || /timeout/i.test(err.message || '')) {
        throw ToledoError.fromCode(CODES.CONNECTION_TIMEOUT, err.message, { statusCode: 408 });
      }
      throw ToledoError.fromCode(CODES.DEVICE_OFFLINE, err.message || 'Falha ao conectar', {
        statusCode: err.statusCode || 503
      });
    }

    await log.info('Socket conectado', {
      operacao: 'toledo_driver_v1',
      contexto: { host, porta, latencia: conn.latencia }
    });

    try {
      // RC15.8 — handshake só falha por socket fechado / erro de transporte (não por session.state)
      const tcp = this.cm.getTcp?.({ host, porta, equipamentoId: this.equipamentoId });
      const socketOk = Boolean(tcp?.aberto || this.cm.isConnected?.(this._alvo()));
      if (!socketOk) {
        const errSock = new Error('Socket fechado — handshake não iniciado');
        errSock.code = 'SOCKET_CLOSED';
        throw errSock;
      }
      // eslint-disable-next-line no-console
      console.log([
        '',
        '===== HANDSHAKE =====',
        `reutilizada: ${Boolean(conn.reutilizada)}`,
        `session.state: ${conn.session?.state || '—'}`,
        `session.connected: ${conn.session?.connected === true}`,
        '=====================',
        ''
      ].join('\n'));

      // Handshake embutido no Driver.connect (não é UploadPluOperation)
      if (auditAtivo) {
        pipelineAudit.handshakeSolicitado(pipelineAudit.SOLICITANTES.DRIVER, {
          via: 'ToledoPrixIVDriver.connect → handshake()',
          momento: 'após CONNECTED RESTORED'
        });
      }
      await this.handshake({
        timeoutMs: opcoes.handshakeTimeoutMs != null
          ? opcoes.handshakeTimeoutMs
          : LIMITS.handshakeTimeoutMs
      });
      if (auditAtivo) {
        pipelineAudit.handshakeResultado(true);
      }
    } catch (err) {
      if (auditAtivo) {
        pipelineAudit.handshakeResultado(false, err.message || err.code || 'Timeout aguardando resposta de handshake');
        pipelineAudit.marcar('UPLOAD', 'NÃO EXECUTADO', {
          motivo: err.message || 'Timeout aguardando resposta de handshake'
        });
      }
      try { await this.cm.disconnect({ host, porta, force: true }); } catch (_) { /* ignore */ }
      this.status = 'OFFLINE';
      this._online = false;
      this.handshakeOk = false;
      throw err;
    }

    await log.info('Driver ONLINE', {
      operacao: 'toledo_driver_v1',
      contexto: { host, porta, driver: DRIVER, latencia: this.latencia }
    });

    return {
      driver: DRIVER,
      status: conn.reutilizada ? 'CONNECTED_ALREADY' : 'CONNECTED',
      handshake: true,
      latencia: this.latencia != null ? this.latencia : conn.latencia,
      fabricante: FABRICANTE,
      modelo: MODELO,
      reutilizada: Boolean(conn.reutilizada),
      etapas: {
        tcp: true,
        handshake: true,
        health: true,
        driver: true
      }
    };
  }

  /**
   * RC14.14.1 — Reconnect completo: TCP + Handshake + Health
   */
  async reconnect(opcoes = {}) {
    const host = String(opcoes.host || opcoes.ip || this.host || '');
    const porta = Number(opcoes.porta || opcoes.porta_tcp || this.porta || PORTA_PADRAO);
    if (!host || !porta) {
      throw ToledoError.fromCode(CODES.DRIVER_ERROR, 'host e porta obrigatórios', { statusCode: 400 });
    }

    try {
      await this.cm.disconnect({ host, porta, force: true });
    } catch (_) { /* ignore */ }

    this.handshakeOk = false;
    this._online = false;
    this.status = 'RECONNECTING';

    const result = await this.connect({
      ...opcoes,
      host,
      porta,
      persistir: opcoes.persistir !== false
    });

    return {
      ...result,
      status: 'CONNECTED',
      reconectado: true,
      etapas: result.etapas || {
        tcp: true,
        handshake: true,
        health: true,
        driver: true
      }
    };
  }

  async disconnect() {
    if (!this.host || !this.porta) {
      this.status = 'OFFLINE';
      this._online = false;
      this.handshakeOk = false;
      return { status: 'DISCONNECTED', driver: DRIVER };
    }
    const alvo = { host: this.host, porta: this.porta };
    // RC15.9 — origem do encerramento via Driver
    try {
      const { logDisconnectCall } = require('../../connection/SocketCloseAudit');
      const tcp = this.cm.getTcp?.(alvo);
      logDisconnectCall('ToledoPrixIVDriver', 'disconnect()', {
        socket: tcp?.socket || null,
        host: this.host,
        porta: this.porta
      });
    } catch (_) { /* ignore */ }
    try {
      await this.cm.disconnect(alvo);
    } finally {
      this.status = 'OFFLINE';
      this._online = false;
      this.handshakeOk = false;
    }
    return { status: 'DISCONNECTED', driver: DRIVER };
  }

  /**
   * RC15.0.2 — Consulta interface física configurada na balança (ETHERNET | WLAN).
   * Nunca assume ETHERNET. UNKNOWN quando o firmware não informa.
   *
   * @param {object} [opcoes]
   * @returns {Promise<{interface:'ETHERNET'|'WLAN'|'UNKNOWN', protocol:string, source:string, mensagem?:string|null, raw?:*}>}
   */
  async getNetworkInterface(opcoes = {}) {
    const {
      normalizarInterface,
      extrairInterfaceDoPayload,
      NETWORK_INTERFACE,
      NETWORK_PROTOCOL
    } = require('./ToledoNetworkInfo');

    const eq = opcoes.equipamento && typeof opcoes.equipamento === 'object'
      ? opcoes.equipamento
      : {};

    // 1) Overrides explícitos (nunca usar transporte CDS genérico "ethernet")
    const candidatosCadastro = [
      opcoes.interface,
      opcoes.INTERFACE,
      eq.interface_rede,
      eq.network_interface,
      eq.INTERFACE,
      // só aceita se campo dedicado — não eq.transporte
      eq.interface_fisica
    ];
    for (const c of candidatosCadastro) {
      const n = normalizarInterface(c);
      if (n !== NETWORK_INTERFACE.UNKNOWN) {
        return {
          interface: n,
          protocol: NETWORK_PROTOCOL.TCP_IP,
          source: 'cadastro',
          mensagem: null,
          raw: c
        };
      }
    }

    // 2) Leitura no equipamento (config INTERFACE) se houver sessão TCP
    const host = opcoes.host || opcoes.ip || this.host || eq.ip || null;
    const porta = opcoes.porta != null
      ? Number(opcoes.porta)
      : (this.porta || eq.porta_tcp || eq.porta || null);

    const conectado = host && porta && typeof this.cm.isConnected === 'function'
      && this.cm.isConnected({ host, porta }) === true;

    if (conectado) {
      try {
        const prevHost = this.host;
        const prevPorta = this.porta;
        this.host = host;
        this.porta = Number(porta);
        const result = await this.execute(
          'configRead',
          { chave: 'INTERFACE', parametro: 'INTERFACE', INTERFACE: true },
          {
            host,
            porta: Number(porta),
            timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : 2000,
            retries: 0
          }
        );
        this.host = prevHost;
        this.porta = prevPorta;

        let fromDevice = extrairInterfaceDoPayload(result?.payload);
        if (fromDevice === NETWORK_INTERFACE.UNKNOWN) {
          fromDevice = extrairInterfaceDoPayload(result?.parsed?.payload);
        }
        if (fromDevice === NETWORK_INTERFACE.UNKNOWN) {
          fromDevice = extrairInterfaceDoPayload(result);
        }
        if (fromDevice !== NETWORK_INTERFACE.UNKNOWN) {
          return {
            interface: fromDevice,
            protocol: NETWORK_PROTOCOL.TCP_IP,
            source: 'equipamento',
            mensagem: null,
            raw: result?.payload ?? null
          };
        }
        return {
          interface: NETWORK_INTERFACE.UNKNOWN,
          protocol: NETWORK_PROTOCOL.TCP_IP,
          source: 'equipamento',
          mensagem: 'Não informado pelo equipamento',
          raw: result?.payload ?? null
        };
      } catch (_) {
        return {
          interface: NETWORK_INTERFACE.UNKNOWN,
          protocol: NETWORK_PROTOCOL.TCP_IP,
          source: 'unsupported',
          mensagem: 'Não informado pelo equipamento',
          raw: null
        };
      }
    }

    return {
      interface: NETWORK_INTERFACE.UNKNOWN,
      protocol: NETWORK_PROTOCOL.TCP_IP,
      source: 'unsupported',
      mensagem: 'Não informado pelo equipamento',
      raw: null
    };
  }

  isOnline() {
    // RC15.8 — não rejeita só por session.state=RECONNECTING; exige socket/CM utilizável
    try {
      const alvo = this.host && this.porta ? this._alvo() : null;
      if (!alvo) return false;
      const tcp = this.cm.getTcp?.(alvo);
      const socketAberto = Boolean(tcp?.aberto);
      const cmOk = typeof this.cm.isConnected === 'function' ? this.cm.isConnected(alvo) : false;
      // Se socket aberto mas CM ainda marca offline (FSM RECONNECTING), considera online se handshake ok
      if (this._online && this.handshakeOk && (cmOk || socketAberto)) {
        return true;
      }
      return Boolean(this._online && this.handshakeOk && cmOk);
    } catch (_) {
      return false;
    }
  }
}

module.exports = ToledoPrixIVDriver;
module.exports.ToledoPrixIVDriver = ToledoPrixIVDriver;
