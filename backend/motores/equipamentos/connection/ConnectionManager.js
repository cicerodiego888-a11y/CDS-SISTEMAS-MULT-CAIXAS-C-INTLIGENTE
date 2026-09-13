/**
 * Sprint 15.1 — ConnectionManager V2
 * Gerenciador universal: Ethernet / Serial / USB.
 * Pool único, heartbeat, reconexão com backoff 2/4/8s, estados unificados.
 *
 * Compatibilidade V1: connect/disconnect/reconnect/isConnected/health/latency/getTcp
 */

'use strict';

const ConnectionFactory = require('./ConnectionFactory');
const ConnectionPool = require('./ConnectionPool');
const ConnectionHealth = require('./ConnectionHealth');
const { STATUS } = require('./ConnectionHealth');
const ConnectionRepository = require('./ConnectionRepository');
const ConnectionStateMachine = require('./ConnectionStateMachine');
const { STATES } = require('./ConnectionStateMachine');
const ConnectionMetrics = require('./ConnectionMetrics');
const ConnectionHeartbeat = require('./ConnectionHeartbeat');
const connectionEvents = require('./ConnectionEvents');
const { EVENTS } = require('./ConnectionEvents');
const {
  EquipmentSession,
  CONNECTION_MODE,
  criarSessaoAusente
} = require('./EquipmentSession');
const sessionRegistry = require('./EquipmentSessionRegistry');

const BACKOFF_MS = Object.freeze([2000, 4000, 8000]);
const MAX_RECONNECT = 3;
const HEARTBEAT_MS = 30000;

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[connection-v2]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[connection-v2]', msg, ctx || '')
    };
  }
  return logger;
}

function validarHostPorta(host, porta) {
  const h = String(host || '');
  const p = Number(porta) || 0;
  if (!h || !p) {
    const err = new Error('host e porta são obrigatórios.');
    err.statusCode = 400;
    err.code = 'CONNECTION_INPUT_INVALIDO';
    throw err;
  }
  return { host: h, porta: p };
}

function mapEstadoParaHealth(estado) {
  switch (estado) {
    case STATES.CONNECTED:
    case STATES.IDLE:
    case STATES.BUSY:
      return STATUS.ONLINE;
    case STATES.CONNECTING:
    case STATES.RECONNECTING:
      return STATUS.CONNECTING;
    case STATES.ERROR:
      return STATUS.OFFLINE;
    case STATES.DISCONNECTED:
    default:
      return STATUS.DISCONNECTED;
  }
}

function erroReconectavel(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'ECONNREFUSED'
    || code === 'TCP_TIMEOUT'
    || /socket closed|socket destru|ECONNRESET|ETIMEDOUT|ECONNREFUSED|closed/i.test(msg)
  );
}

class ConnectionManager {
  constructor(deps = {}) {
    this.factory = deps.factory || new ConnectionFactory();
    this.pool = deps.pool || new ConnectionPool();
    this.repository = deps.repository || new ConnectionRepository();
    this.events = deps.events || connectionEvents;
    this.timeoutMs = deps.timeoutMs != null ? Number(deps.timeoutMs) : require('../drivers/toledo/ToledoTimeouts').CONNECT;
    this.heartbeatMs = deps.heartbeatMs != null ? Number(deps.heartbeatMs) : HEARTBEAT_MS;
    this.autoReconnect = deps.autoReconnect !== false;
    this.autoHeartbeat = deps.autoHeartbeat !== false;
    this._version = '2.0';
  }

  get eventsBus() {
    return this.events;
  }

  _logEstado(entry, from, to, extra = {}) {
    const ctx = {
      from,
      to,
      host: entry.host,
      porta: entry.porta,
      equipamentoId: entry.equipamentoId,
      latencia: entry.metrics?.latenciaMedia ?? entry.health?.latencia,
      ...extra
    };
    getLogger().info(`${from} → ${to}`, {
      operacao: 'connection_v2',
      contexto: ctx
    }).catch(() => {});
  }

  _capturarOrigemTransicao(meta = {}) {
    let stack = '';
    try {
      const err = new Error('state_change');
      stack = String(err.stack || '')
        .split('\n')
        .slice(2, 10)
        .map((l) => l.trim())
        .join(' | ');
    } catch (_) { /* ignore */ }
    return {
      origem: meta.origem || meta.op || 'ConnectionManager',
      arquivo: meta.arquivo || 'ConnectionManager.js',
      stack
    };
  }

  /**
   * RC14.14.7 — estado de repouso após socket OK = CONNECTED (nunca IDLE direto de CONNECTING).
   */
  _estadoRepousoConectado() {
    return STATES.CONNECTED;
  }

  _transitar(entry, para, meta = {}) {
    let destino = para;
    const from = entry.fsm.estado;

    // RC14.14.7 — nunca CONNECTING/RECONNECTING → IDLE
    if (
      (from === STATES.CONNECTING || from === STATES.RECONNECTING)
      && destino === STATES.IDLE
    ) {
      destino = STATES.CONNECTED;
      meta = { ...meta, corrigidoRc14147: true, destinoOriginal: STATES.IDLE };
    }

    const origem = this._capturarOrigemTransicao(meta);
    let evento;
    try {
      evento = entry.fsm.transitar(destino, { ...meta, ...origem });
    } catch (err) {
      // Não forçar transição proibida CONNECTING→IDLE
      if (err && err.code === 'STATE_TRANSITION_PROIBIDA') {
        destino = STATES.CONNECTED;
        evento = entry.fsm.transitar(destino, { ...meta, ...origem, corrigidoRc14147: true });
      } else {
        evento = entry.fsm.forcar(destino, { ...meta, ...origem });
      }
    }
    if (evento?.noop) return evento;
    entry.health.setStatus(mapEstadoParaHealth(destino));
    // Sessão oficial acompanha FSM
    this._syncSession(entry, {
      mode: meta.connectionMode || meta.mode || null,
      latency: meta.latencia != null ? meta.latencia : null,
      error: meta.motivo || meta.erro || null
    });
    if (destino === STATES.CONNECTED) {
      this._ensureSession(entry);
      if (entry.session && !entry.session.connected) {
        entry.session.markConnected(
          meta.connectionMode || CONNECTION_MODE.NEW_CONNECTION,
          meta.latencia
        );
      }
      if (entry.session) {
        if (entry.host) entry.session.host = entry.host;
        if (entry.porta != null) entry.session.porta = Number(entry.porta);
        if (entry.equipamentoId != null) entry.session.equipamentoId = entry.equipamentoId;
        if (!entry.session.connectedAt) {
          entry.session.connectedAt = new Date().toISOString();
        }
      }
    }
    this._logEstado(entry, from, destino, { ...meta, ...origem });
    getLogger().info('STATE CHANGE', {
      operacao: 'connection_state',
      contexto: {
        evento: `${from} → ${destino}`,
        origem: origem.origem,
        arquivo: origem.arquivo,
        stack: origem.stack,
        host: entry.host,
        porta: entry.porta,
        connectionMode: meta.connectionMode || null
      }
    }).catch(() => {});
    this.events.emitStateChanged({
      key: entry._poolKey,
      host: entry.host,
      porta: entry.porta,
      equipamentoId: entry.equipamentoId,
      from,
      to: destino,
      origem: origem.origem,
      stack: origem.stack,
      session: entry.session ? entry.session.snapshot() : null,
      ...meta
    });
    return evento;
  }

  /**
   * RC14.14.7 — uma única EquipmentSession por equipamento (registry).
   */
  _ensureSession(entry) {
    if (!entry) return null;
    return sessionRegistry.bindEntry(entry);
  }

  _syncSession(entry, opts = {}) {
    const session = this._ensureSession(entry);
    if (!session) return null;
    const mode = opts.mode || null;
    session.syncFromFsm(entry.fsm?.estado, {
      mode: mode || undefined,
      latency: opts.latency,
      error: opts.error
    });
    if (entry.host) session.host = entry.host;
    if (entry.porta != null) session.porta = Number(entry.porta);
    if (entry.equipamentoId != null) session.equipamentoId = entry.equipamentoId;
    return session;
  }

  /**
   * RC14.14.9 — commit obrigatório da EquipmentSession antes de qualquer return CONNECTED.
   * Proibido retornar "conectado" sem atualizar a sessão oficial.
   */
  _commitSessionConnected(entry, opts = {}) {
    if (!entry) {
      const err = new Error('SESSION UPDATE sem entry — connect abortado');
      err.code = 'SESSION_UPDATE_REQUIRED';
      throw err;
    }
    const mode = opts.mode || CONNECTION_MODE.NEW_CONNECTION;
    const latency = opts.latency != null ? opts.latency : null;
    const persistent = opts.persistent != null
      ? opts.persistent === true
      : entry.persistir !== false;

    const session = this._ensureSession(entry);
    if (!session) {
      const err = new Error('SESSION UPDATE falhou — EquipmentSession ausente');
      err.code = 'SESSION_UPDATE_REQUIRED';
      throw err;
    }

    // Força campos oficiais (não depende de syncFromFsm / ordem de _transitar)
    session.host = entry.host != null ? String(entry.host) : session.host;
    session.porta = entry.porta != null && Number.isFinite(Number(entry.porta))
      ? Number(entry.porta)
      : session.porta;
    if (entry.equipamentoId != null) session.equipamentoId = Number(entry.equipamentoId);
    if (entry.transporte) session.transporte = entry.transporte;

    // markConnected cuida de state/connected/mode/latency/connectedAt/reconnectCount
    session.markConnected(mode, latency, {
      host: entry.host,
      porta: entry.porta,
      equipamentoId: entry.equipamentoId
    });
    session.persistent = persistent;
    if (entry.transporte) session.transporte = entry.transporte;
    // Reforço explícito (critério RC14.14.9)
    if (entry.host != null) session.host = String(entry.host);
    if (entry.porta != null && Number.isFinite(Number(entry.porta))) {
      session.porta = Number(entry.porta);
    }
    session.connected = true;
    session.state = require('./EquipmentSession').SESSION_STATE.CONNECTED;
    session.connectionMode = mode;
    if (!session.connectedAt) session.connectedAt = new Date().toISOString();

    entry.session = session;

    const snap = session.snapshot();
    getLogger().info('SESSION UPDATE', {
      operacao: 'session_update',
      contexto: {
        connected: snap.connected,
        state: snap.state,
        persistent: snap.persistent,
        host: snap.host,
        porta: snap.porta,
        connectionMode: snap.connectionMode,
        connectedAt: snap.connectedAt,
        latency: snap.latency,
        equipamentoId: snap.equipamentoId
      }
    }).catch(() => {});

    // Critério duro: nunca retornar CONNECTED com sessão incoerente
    if (snap.connected !== true || snap.state !== 'CONNECTED') {
      const err = new Error('SESSION UPDATE inconsistente após connect');
      err.code = 'SESSION_UPDATE_INCONSISTENT';
      err.session = snap;
      throw err;
    }
    return snap;
  }

  async _persistir(entry) {
    if (!entry || entry.persistir === false) return;
    const snap = entry.health.snapshot();
    const metrics = entry.metrics.snapshot();
    try {
      await this.repository.salvar({
        host: entry.host,
        porta: entry.porta,
        equipamento_id: entry.equipamentoId || null,
        transporte: entry.transporte || 'ethernet',
        status: entry.fsm.estado,
        latencia: snap.latencia,
        conectado_em: snap.conectadoEm,
        desconectado_em: snap.desconectadoEm,
        ultima_atividade: snap.ultimaAtividade,
        reconexoes: metrics.reconexoes,
        metricas: metrics
      });
    } catch (_) { /* não bloqueia */ }
  }

  _bindTransportEvents(entry) {
    const tr = entry.transport;
    if (!tr || typeof tr.on !== 'function') return;

    tr.removeAllListeners?.('close');
    tr.removeAllListeners?.('error');
    tr.removeAllListeners?.('timeout');
    tr.removeAllListeners?.('data');

    tr.on('data', (buf) => {
      const n = Buffer.isBuffer(buf) ? buf.length : 0;
      entry.metrics.registrarRecebimento(n);
      entry.health.touch();
      this.events.emitPacketReceived({
        host: entry.host,
        porta: entry.porta,
        equipamentoId: entry.equipamentoId,
        bytes: n
      });
    });

    tr.on('timeout', async () => {
      entry.metrics.registrarErro({ code: 'TIMEOUT', message: 'Timeout de conexão' });
      this.events.emitTimeout({ host: entry.host, porta: entry.porta });
      if (entry.fsm.ativo) {
        this._transitar(entry, STATES.ERROR, { motivo: 'timeout' });
        await this._persistir(entry);
        if (this.autoReconnect && !entry._manualClose) {
          this._agendarReconexao(entry).catch(() => {});
        }
      }
    });

    tr.on('close', async () => {
      if (entry._manualClose) return;
      if (entry.fsm.ativo || entry.fsm.estado === STATES.CONNECTING) {
        entry.metrics.marcarDesconectado();
        this._transitar(entry, STATES.DISCONNECTED, { motivo: 'socket_closed' });
        this.events.emitDisconnected({
          host: entry.host,
          porta: entry.porta,
          equipamentoId: entry.equipamentoId
        });
        await this._persistir(entry);
        if (this.autoReconnect) {
          this._agendarReconexao(entry).catch(() => {});
        }
      }
    });

    tr.on('error', async (err) => {
      entry.metrics.registrarErro(err);
      this.events.emitError({
        host: entry.host,
        porta: entry.porta,
        erro: err?.message,
        codigo: err?.code
      });
      if (erroReconectavel(err) && this.autoReconnect && !entry._manualClose) {
        this._agendarReconexao(entry).catch(() => {});
      } else if (entry.fsm.ativo) {
        this._transitar(entry, STATES.ERROR, { motivo: err?.code || err?.message });
        await this._persistir(entry);
      }
    });
  }

  _iniciarHeartbeat(entry) {
    if (!this.autoHeartbeat) return;
    if (entry.heartbeat) entry.heartbeat.parar();

    const { deveSuspenderHeartbeat, podeHeartbeatDisconnect } = require('./SessionBusy');

    entry.heartbeat = new ConnectionHeartbeat({
      intervaloMs: this.heartbeatMs,
      onTick: async () => {
        const session = this._ensureSession(entry);
        // RC15.10 — operação ativa: heartbeat suspende (não falha / não disconnect)
        if (deveSuspenderHeartbeat(session)) {
          return { ok: true, skipped: true, motivo: 'session_busy' };
        }
        if (!entry.fsm.ativo) {
          // Sessão persistente com socket aberto: só ping, sem tratar como falha fatal
          if (session?.persistent && entry.transport?.aberto) {
            try {
              const r = await entry.transport.ping();
              return { ok: Boolean(r?.ok), latencia: r?.latencia, soft: true };
            } catch (err) {
              return { ok: true, skipped: true, motivo: 'persistent_soft', erro: err };
            }
          }
          return { ok: false, motivo: 'inativo' };
        }
        try {
          const r = await entry.transport.ping();
          entry.metrics.registrarHeartbeat(Boolean(r?.ok), { latencia: r?.latencia });
          if (r?.latencia != null) entry.health.latencia = r.latencia;
          // RC14.14.8 — heartbeat oficial atualiza heartbeatAt / latency / connectionMode
          session?.touchHeartbeat(
            r?.latencia,
            CONNECTION_MODE.REUSED_SESSION
          );
          this.events.emitHeartbeat({
            host: entry.host,
            porta: entry.porta,
            equipamentoId: entry.equipamentoId,
            ok: Boolean(r?.ok),
            latencia: r?.latencia,
            connectionMode: CONNECTION_MODE.REUSED_SESSION
          });
          entry.health.touch();
          await this._persistir(entry);
          return { ok: Boolean(r?.ok), latencia: r?.latencia };
        } catch (err) {
          entry.metrics.registrarHeartbeat(false);
          // RC15.10 — falha de ping em sessão persistente NÃO vira disconnect
          if (!podeHeartbeatDisconnect(session) && entry.transport?.aberto) {
            return { ok: true, skipped: true, motivo: 'persistent_ping_error', erro: err };
          }
          return { ok: false, erro: err };
        }
      },
      onFalha: async () => {
        if (entry._manualClose) return;
        const session = this._ensureSession(entry);
        // RC15.10 — nunca disconnect/reconexão destrutiva se busy ou persistent+connected
        if (!podeHeartbeatDisconnect(session)) {
          await getLogger().info('Heartbeat falhou — disconnect bloqueado (RC15.10)', {
            operacao: 'connection_v2',
            contexto: {
              host: entry.host,
              porta: entry.porta,
              busy: session?.busy === true,
              connected: session?.connected === true,
              persistent: session?.persistent === true
            }
          });
          return;
        }
        this._transitar(entry, STATES.RECONNECTING, { motivo: 'heartbeat_falhou' });
        await this._agendarReconexao(entry);
      }
    });
    entry.heartbeat.iniciar();
  }

  async _agendarReconexao(entry) {
    if (entry._reconnectLock) return;
    const { podeHeartbeatDisconnect } = require('./SessionBusy');
    const sessionGate = this._ensureSession(entry);
    // RC15.10 — não destruir socket durante operação / sessão persistente viva
    if (!podeHeartbeatDisconnect(sessionGate) && entry.transport?.aberto) {
      return;
    }
    entry._reconnectLock = true;
    entry._manualClose = false;
    entry._reconnectAbort = false;

    try {
      this._transitar(entry, STATES.RECONNECTING, {});
      this.events.emitReconnecting({
        host: entry.host,
        porta: entry.porta,
        equipamentoId: entry.equipamentoId
      });

      for (let tentativa = 0; tentativa < MAX_RECONNECT; tentativa += 1) {
        if (entry._manualClose || entry._reconnectAbort) return;
        if (!podeHeartbeatDisconnect(this._ensureSession(entry)) && entry.transport?.aberto) {
          return;
        }
        // RC15.8 — se connect() já restaurou socket/CONNECTED, aborta reconexão
        if (entry.transport?.aberto && entry.fsm?.ativo && entry.session?.connected) {
          return;
        }
        const delay = BACKOFF_MS[Math.min(tentativa, BACKOFF_MS.length - 1)];
        await getLogger().info('Reconexão automática', {
          operacao: 'connection_v2',
          contexto: {
            host: entry.host,
            porta: entry.porta,
            tentativa: tentativa + 1,
            delayMs: delay
          }
        });
        await new Promise((r) => setTimeout(r, delay));
        if (entry._manualClose || entry._reconnectAbort) return;
        if (entry.transport?.aberto && entry.fsm?.ativo && entry.session?.connected) {
          return;
        }

        try {
          try { entry.transport.destroy(); } catch (_) { /* ignore */ }
          entry.transport = this.factory.create({
            transporte: entry.transporte,
            host: entry.host,
            porta: entry.porta,
            porta_com: entry.porta_com,
            vid: entry.vid,
            pid: entry.pid,
            caminho_dispositivo: entry.caminho,
            timeoutMs: entry.timeoutMs || this.timeoutMs
          });
          this._bindTransportEvents(entry);
          this._transitar(entry, STATES.CONNECTING, { tentativa: tentativa + 1 });
          const r = await entry.transport.connect();
          entry.metrics.incrementarReconexoes();
          entry.metrics.marcarConectado(r?.latencia);
          entry.health.marcarConectado(r?.latencia);
          entry.health.reconexoes = entry.metrics.reconexoes;
          this._transitar(entry, STATES.CONNECTED, {
            latencia: r?.latencia,
            connectionMode: CONNECTION_MODE.AUTO_RECONNECT,
            origem: 'ConnectionManager._agendarReconexao'
          });
          // RC14.14.9 — SESSION UPDATE também na reconexão automática
          const sessionSnap = this._commitSessionConnected(entry, {
            mode: CONNECTION_MODE.AUTO_RECONNECT,
            latency: r?.latencia,
            persistent: entry.persistir !== false
          });
          this.events.emitConnected({
            host: entry.host,
            porta: entry.porta,
            latencia: r?.latencia,
            reconexao: true,
            connectionMode: CONNECTION_MODE.AUTO_RECONNECT,
            session: sessionSnap
          });
          this._iniciarHeartbeat(entry);
          await this._persistir(entry);
          return;
        } catch (err) {
          entry.metrics.registrarErro(err);
        }
      }

      this._transitar(entry, STATES.ERROR, {
        motivo: 'max_reconnect',
        connectionMode: CONNECTION_MODE.ERROR
      });
      entry.health.marcarDesconectado(STATUS.OFFLINE);
      this._ensureSession(entry)?.markError('max_reconnect');
      await this._persistir(entry);
      this.events.emitError({
        host: entry.host,
        porta: entry.porta,
        codigo: 'MAX_RECONNECT',
        erro: 'Falha definitiva após 3 tentativas'
      });
    } finally {
      entry._reconnectLock = false;
    }
  }

  /**
   * Resolve alvo a partir de id de equipamento cadastrado.
   */
  async _resolverEquipamento(id) {
    try {
      const equipamentosRepository = require('../repositories/EquipamentosRepository');
      const eq = await equipamentosRepository.buscarPorId(id);
      if (!eq) {
        const err = new Error(`Equipamento ${id} não encontrado.`);
        err.statusCode = 404;
        err.code = 'EQUIPAMENTO_NAO_ENCONTRADO';
        throw err;
      }
      return {
        equipamentoId: Number(eq.id),
        host: eq.ip || eq.host || null,
        porta: Number(eq.porta_tcp || eq.porta) || null,
        porta_com: eq.porta_com || null,
        transporte: String(eq.transporte || 'ethernet').toLowerCase(),
        vid: eq.vid || null,
        pid: eq.pid || null,
        timeoutMs: Number(eq.timeout_ms) || this.timeoutMs
      };
    } catch (err) {
      if (err.statusCode) throw err;
      throw err;
    }
  }

  async _normalizarOpcoes(opcoes = {}) {
    const opts = { ...opcoes };
    if (opts.equipamentoId != null || opts.equipamento_id != null || opts.id != null) {
      const id = opts.equipamentoId ?? opts.equipamento_id ?? opts.id;
      const eq = await this._resolverEquipamento(id);
      return {
        ...eq,
        ...opts,
        equipamentoId: eq.equipamentoId,
        host: opts.host || opts.ip || eq.host,
        porta: opts.porta || opts.porta_tcp || eq.porta,
        transporte: opts.transporte || eq.transporte
      };
    }
    return {
      ...opts,
      host: opts.host || opts.ip,
      porta: opts.porta || opts.porta_tcp,
      transporte: String(opts.transporte || 'ethernet').toLowerCase()
    };
  }

  /**
   * Conecta (ou reutiliza) — V1 + V2.
   */
  async connect(opcoes = {}) {
    const alvo = await this._normalizarOpcoes(opcoes);
    const transporte = String(alvo.transporte || 'ethernet').toLowerCase();
    const log = getLogger();
    const timeoutMs = alvo.timeoutMs != null ? alvo.timeoutMs : this.timeoutMs;
    const ConnectionTrace = require('./ConnectionTrace');
    const { classificarErroTcp } = require('./TcpConnectStatus');
    const trace = ConnectionTrace.criar({
      host: alvo.host,
      porta: alvo.porta,
      timeoutMs
    });
    trace.inicioConnect();
    const t0 = Date.now();

    // Localizar existente
    let existente = null;
    if (alvo.equipamentoId != null) {
      existente = this.pool.get({ equipamentoId: alvo.equipamentoId });
    }
    if (!existente && alvo.host && alvo.porta) {
      existente = this.pool.get(alvo.host, alvo.porta);
    }
    if (!existente && alvo.porta_com) {
      existente = this.pool.get({ porta_com: alvo.porta_com });
    }

    // RC15.8 — reutiliza socket aberto mesmo se FSM/sessão estiver RECONNECTING
    const socketAberto = Boolean(
      existente
      && (existente.transport?.aberto === true
        || existente.tcp?.aberto === true
        || (typeof existente.transport?.isOpen === 'function' && existente.transport.isOpen()))
    );
    if (existente && socketAberto) {
      // RC15.6 — unifica aliases eq↔hp quando reutiliza sessão encontrada só por um dos lados
      if (alvo.equipamentoId != null && existente.equipamentoId == null) {
        existente.equipamentoId = Number(alvo.equipamentoId);
        if (existente.meta) existente.meta.equipamentoId = existente.equipamentoId;
      }
      if (existente.equipamentoId != null && existente._poolKey) {
        this.pool._aliases.set(
          require('./ConnectionPool').chaveEquipamento(existente.equipamentoId),
          existente._poolKey
        );
      }
      if (existente.host && existente.porta != null && existente._poolKey) {
        this.pool._aliases.set(
          require('./ConnectionPool').chaveHostPorta(existente.host, existente.porta),
          existente._poolKey
        );
      }

      // eslint-disable-next-line no-console
      console.log([
        '',
        '===== REUSED SOCKET =====',
        `Host: ${existente.host || '—'}`,
        `Porta: ${existente.porta != null ? existente.porta : '—'}`,
        `FSM antes: ${existente.fsm?.estado || '—'}`,
        `Session antes: ${existente.session?.state || '—'} connected=${existente.session?.connected}`,
        '=========================',
        ''
      ].join('\n'));

      // Aborta reconexão em andamento — socket válido será restaurado
      existente._reconnectAbort = true;
      existente._reconnectLock = false;

      const lat = existente.health.latencia;
      // RC15.8 — FSM + sessão CONNECTED ANTES de qualquer handshake
      this._transitar(existente, STATES.CONNECTED, {
        connectionMode: CONNECTION_MODE.REUSED_SESSION,
        latencia: lat,
        origem: 'ConnectionManager.connect.reuse',
        rc158: true
      });
      const sessionSnap = this._commitSessionConnected(existente, {
        mode: CONNECTION_MODE.REUSED_SESSION,
        latency: lat,
        persistent: existente.persistir !== false
      });
      // Reforço duro RC15.8
      if (existente.session) {
        existente.session.state = 'CONNECTED';
        existente.session.connected = true;
        existente.session.connectionMode = CONNECTION_MODE.REUSED_SESSION;
      }

      // eslint-disable-next-line no-console
      console.log([
        '',
        '===== CONNECTED RESTORED =====',
        `FSM: ${existente.fsm?.estado || '—'}`,
        `Session: ${existente.session?.state || '—'}`,
        `connected: ${existente.session?.connected === true}`,
        `connectionMode: ${CONNECTION_MODE.REUSED_SESSION}`,
        `transportAberto: ${socketAberto}`,
        '==============================',
        ''
      ].join('\n'));

      trace.socketOk({ latenciaMs: lat, reutilizada: true });
      trace.connectionMode = CONNECTION_MODE.REUSED_SESSION;
      trace.finalizar('CONNECTED_ALREADY');
      await ConnectionTrace.emitir(trace);
      await log.info('Conexão ativa (pool)', {
        operacao: 'connection_v2',
        contexto: {
          host: existente.host,
          porta: existente.porta,
          reutilizada: true,
          connectionMode: CONNECTION_MODE.REUSED_SESSION,
          timeoutMs,
          session: sessionSnap,
          fsm: existente.fsm.estado,
          rc158: true,
          trace: trace.toJSON()
        }
      });
      return {
        status: 'CONNECTED_ALREADY',
        estado: existente.fsm.estado,
        latencia: lat,
        reutilizada: true,
        equipamentoId: existente.equipamentoId,
        connectCodigo: 'TCP_CONNECT_OK',
        connectionMode: CONNECTION_MODE.REUSED_SESSION,
        session: existente.session ? existente.session.snapshot() : sessionSnap,
        transportAberto: true,
        connectionTrace: trace.toJSON()
      };
    }

    if (existente) {
      try { existente.heartbeat?.parar(); } catch (_) { /* ignore */ }
      try { existente.transport?.destroy(); } catch (_) { /* ignore */ }
      this.pool.delete(existente);
    }

    if (transporte === 'ethernet' || transporte === 'tcp') {
      validarHostPorta(alvo.host, alvo.porta);
    }

    const fsm = new ConnectionStateMachine({
      onTransition: (ev) => {
        /* log já em _transitar */
      }
    });
    const health = new ConnectionHealth({ status: STATUS.CONNECTING });
    const metrics = new ConnectionMetrics();

    const transport = this.factory.create({
      transporte,
      host: alvo.host,
      porta: alvo.porta,
      porta_com: alvo.porta_com,
      vid: alvo.vid,
      pid: alvo.pid,
      caminho_dispositivo: alvo.caminho_dispositivo,
      timeoutMs
    });

    const entry = {
      equipamentoId: alvo.equipamentoId || null,
      host: alvo.host || null,
      porta: alvo.porta || null,
      porta_com: alvo.porta_com || null,
      vid: alvo.vid || null,
      pid: alvo.pid || null,
      caminho: alvo.caminho_dispositivo || null,
      transporte,
      transport,
      tcp: typeof transport.getTcp === 'function' ? transport.getTcp() : null,
      fsm,
      health,
      metrics,
      heartbeat: null,
      session: null,
      persistir: alvo.persistir !== false,
      timeoutMs,
      _manualClose: alvo.persistir === false,
      _reconnectLock: false,
      meta: {
        host: alvo.host || null,
        porta: alvo.porta || null,
        transporte,
        equipamentoId: alvo.equipamentoId || null
      }
    };
    this._ensureSession(entry).markConnecting(CONNECTION_MODE.NEW_CONNECTION);

    // Compat V1: entry.tcp aponta para TcpConnection
    if (!entry.tcp && transport.getTcp) {
      entry.tcp = transport.getTcp();
    }

    this.pool.set({
      equipamentoId: entry.equipamentoId,
      host: entry.host,
      porta: entry.porta,
      porta_com: entry.porta_com,
      vid: entry.vid,
      pid: entry.pid,
      caminho_dispositivo: entry.caminho
    }, entry);

    // Alias V1 host:porta (sem duplicar entrada)
    if (entry.host && entry.porta && entry._poolKey) {
      this.pool._aliases.set(
        require('./ConnectionPool').chaveHostPorta(entry.host, entry.porta),
        entry._poolKey
      );
    }

    this._bindTransportEvents(entry);
    this._transitar(entry, STATES.CONNECTING, {});

    await log.info('Solicitação de conexão', {
      operacao: 'connection_v2',
      contexto: {
        host: entry.host,
        porta: entry.porta,
        transporte,
        equipamentoId: entry.equipamentoId,
        timeoutMs
      }
    });

    try {
      const { latencia } = await transport.connect();
      const latMs = latencia != null ? latencia : (Date.now() - t0);
      health.marcarConectado(latMs);
      metrics.marcarConectado(latMs);
      this._transitar(entry, STATES.CONNECTED, {
        latencia: latMs,
        connectionMode: CONNECTION_MODE.NEW_CONNECTION,
        origem: 'ConnectionManager.connect'
      });
      // RC14.14.9 — SESSION UPDATE obrigatório ANTES do return CONNECTED
      const sessionSnap = this._commitSessionConnected(entry, {
        mode: CONNECTION_MODE.NEW_CONNECTION,
        latency: latMs,
        persistent: entry.persistir !== false
      });
      this.events.emitConnected({
        host: entry.host,
        porta: entry.porta,
        equipamentoId: entry.equipamentoId,
        latencia: latMs,
        transporte,
        connectionMode: CONNECTION_MODE.NEW_CONNECTION,
        session: sessionSnap
      });
      this._iniciarHeartbeat(entry);
      await this._persistir(entry);

      trace.socketOk({ latenciaMs: latMs, reutilizada: false });
      trace.connectionMode = CONNECTION_MODE.NEW_CONNECTION;
      trace.finalizar('CONNECTED');
      await ConnectionTrace.emitir(trace);

      await log.info('Conexão ativa', {
        operacao: 'connection_v2',
        contexto: {
          host: entry.host,
          porta: entry.porta,
          latencia: latMs,
          estado: STATES.CONNECTED,
          connectionMode: CONNECTION_MODE.NEW_CONNECTION,
          timeoutMs,
          connectCodigo: 'TCP_CONNECT_OK',
          session: sessionSnap,
          trace: trace.toJSON()
        }
      });

      // Releitura viva — JSON deve espelhar exatamente a EquipmentSession oficial
      const live = this.getSession({ host: entry.host, porta: entry.porta, equipamentoId: entry.equipamentoId });
      const liveSnap = live ? live.snapshot() : sessionSnap;

      return {
        status: 'CONNECTED',
        estado: entry.fsm.estado,
        latencia: latMs,
        equipamentoId: entry.equipamentoId,
        transporte,
        connectCodigo: 'TCP_CONNECT_OK',
        connectionMode: liveSnap.connectionMode || CONNECTION_MODE.NEW_CONNECTION,
        session: liveSnap,
        connectionTrace: trace.toJSON()
      };
    } catch (err) {
      const latMs = Date.now() - t0;
      const codigo = classificarErroTcp(err);
      metrics.registrarErro(err);
      this._transitar(entry, STATES.ERROR, {
        motivo: err.code || err.message,
        connectionMode: CONNECTION_MODE.ERROR
      });
      health.marcarDesconectado(err.code === 'TCP_TIMEOUT' ? STATUS.TIMEOUT : STATUS.OFFLINE);
      this._ensureSession(entry)?.markError(err.message || codigo);
      await this._persistir(entry);
      try { transport.destroy(); } catch (_) { /* ignore */ }
      this.pool.delete(entry);
      if (entry.host && entry.porta) this.pool.delete(entry.host, entry.porta);

      trace.socketFalha({ codigo, erro: err.message, latenciaMs: latMs });
      trace.connectionMode = CONNECTION_MODE.ERROR;
      trace.finalizar(codigo);
      await ConnectionTrace.emitir(trace);

      err.connectCodigo = codigo;
      err.connectionMode = CONNECTION_MODE.ERROR;
      err.connectionTrace = trace.toJSON();
      throw err;
    }
  }

  async disconnect(opcoes = {}) {
    const alvo = await this._normalizarOpcoes(opcoes);
    const entry = this.getConnection(alvo);
    if (!entry) {
      return { status: 'DISCONNECTED', estado: STATES.DISCONNECTED, latencia: null };
    }

    // RC15.10 — bloqueia disconnect durante operação ativa (force=true para quit/ERP)
    const force = opcoes.force === true || opcoes.forcar === true;
    const sessionBusy = this._ensureSession(entry);
    if (!force && sessionBusy?.busy === true) {
      await getLogger().warn('disconnect bloqueado — session.busy (RC15.10)', {
        operacao: 'connection_v2',
        contexto: {
          host: entry.host,
          porta: entry.porta,
          busyReason: sessionBusy.busyReason,
          busyDepth: sessionBusy.busyDepth
        }
      });
      const err = new Error('disconnect bloqueado: operação ativa na sessão (busy)');
      err.code = 'SESSION_BUSY';
      err.statusCode = 409;
      throw err;
    }

    // RC15.9 — quem pediu o encerramento
    try {
      const { logDisconnectCall } = require('./SocketCloseAudit');
      const sock = entry.transport?.getTcp?.()?.socket
        || entry.tcp?.socket
        || null;
      logDisconnectCall('ConnectionManager', 'disconnect()', {
        socket: sock,
        host: entry.host,
        porta: entry.porta
      });
    } catch (_) { /* ignore */ }

    entry._manualClose = true;
    try { entry.heartbeat?.parar(); } catch (_) { /* ignore */ }

    try {
      await entry.transport.disconnect();
    } finally {
      try { entry.transport.destroy(); } catch (_) { /* ignore */ }
      entry.metrics.marcarDesconectado();
      this._transitar(entry, STATES.DISCONNECTED, {
        motivo: 'manual',
        connectionMode: CONNECTION_MODE.DISCONNECTED
      });
      entry.health.marcarDesconectado(STATUS.DISCONNECTED);
      this._ensureSession(entry)?.markDisconnected('manual');
      await this._persistir(entry);
      this.events.emitDisconnected({
        host: entry.host,
        porta: entry.porta,
        equipamentoId: entry.equipamentoId,
        manual: true,
        connectionMode: CONNECTION_MODE.DISCONNECTED
      });
      const sessionSnap = entry.session ? entry.session.snapshot() : null;
      this.pool.delete(entry);
      if (entry.host && entry.porta) this.pool.delete(entry.host, entry.porta);

      return {
        status: 'DISCONNECTED',
        estado: STATES.DISCONNECTED,
        latencia: entry.health.latencia,
        connectionMode: CONNECTION_MODE.DISCONNECTED,
        session: sessionSnap
      };
    }
  }

  isConnected(opcoes = {}) {
    try {
      if ((opcoes.host || opcoes.ip) && (opcoes.porta || opcoes.porta_tcp)) {
        const entry = this.pool.get(opcoes.host || opcoes.ip, opcoes.porta || opcoes.porta_tcp);
        return Boolean(entry && entry.fsm?.ativo && entry.transport?.aberto);
      }
      if (opcoes.equipamentoId != null || opcoes.equipamento_id != null || opcoes.id != null) {
        const entry = this.pool.get({
          equipamentoId: opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id
        });
        return Boolean(entry && entry.fsm?.ativo && entry.transport?.aberto);
      }
      if (opcoes.porta_com || opcoes.vid || opcoes.pid || opcoes.caminho_dispositivo) {
        const entry = this.pool.get(opcoes);
        return Boolean(entry && entry.fsm?.ativo && entry.transport?.aberto);
      }
      const entry = this.getConnection(opcoes);
      return Boolean(entry && entry.fsm?.ativo && entry.transport?.aberto);
    } catch (_) {
      return false;
    }
  }

  async reconnect(opcoes = {}) {
    const alvo = await this._normalizarOpcoes(opcoes);
    const prev = this.getConnection(alvo);
    const reconexoesAnteriores = prev ? Number(prev.metrics?.reconexoes) || 0 : 0;

    if (prev) {
      try { await this.disconnect(alvo); } catch (_) { /* ignore */ }
    }

    const result = await this.connect({ ...alvo, persistir: opcoes.persistir });
    const entry = this.getConnection(alvo);
    if (entry) {
      entry.metrics.reconexoes = reconexoesAnteriores + 1;
      entry.health.reconexoes = entry.metrics.reconexoes;
      await this._persistir(entry);
    }

    return { ...result, reconexoes: reconexoesAnteriores + 1 };
  }

  /**
   * Envia bytes via Connection Manager (Drivers NÃO abrem socket).
   */
  async send(opcoes = {}, data) {
    const entry = this.getConnection(await this._normalizarOpcoes(opcoes));
    // RC15.8 — socket aberto + sessão RECONNECTING → restaura CONNECTED (não rejeita só por state)
    if (entry && entry.transport?.aberto && !entry.fsm?.ativo) {
      this._transitar(entry, STATES.CONNECTED, {
        connectionMode: CONNECTION_MODE.REUSED_SESSION,
        origem: 'ConnectionManager.send.restore',
        rc158: true
      });
      this._commitSessionConnected(entry, {
        mode: CONNECTION_MODE.REUSED_SESSION,
        persistent: entry.persistir !== false
      });
    }
    if (!entry || !entry.fsm.ativo) {
      const err = new Error('EthernetTransport: não conectado');
      err.code = 'NOT_CONNECTED';
      err.statusCode = 409;
      throw err;
    }
    this._transitar(entry, STATES.BUSY, { op: 'send' });
    try {
      const n = await entry.transport.send(data);
      entry.metrics.registrarEnvio(n);
      entry.health.touch();
      this.events.emitPacketSent({
        host: entry.host,
        porta: entry.porta,
        bytes: n
      });
      return n;
    } finally {
      if (entry.fsm.estado === STATES.BUSY) {
        this._transitar(entry, STATES.CONNECTED, { op: 'send_done', origem: 'ConnectionManager.send' });
      }
    }
  }

  async receive(opcoes = {}, readOpts = {}) {
    const entry = this.getConnection(await this._normalizarOpcoes(opcoes));
    if (!entry || !entry.fsm.ativo) {
      const err = new Error('EthernetTransport: não conectado');
      err.code = 'NOT_CONNECTED';
      err.statusCode = 409;
      throw err;
    }
    this._transitar(entry, STATES.BUSY, { op: 'receive' });
    try {
      const buf = await entry.transport.receive(readOpts);
      if (buf) {
        entry.metrics.registrarRecebimento(buf.length);
        this.events.emitPacketReceived({
          host: entry.host,
          porta: entry.porta,
          bytes: buf.length
        });
      }
      entry.health.touch();
      return buf;
    } finally {
      if (entry.fsm.estado === STATES.BUSY) {
        this._transitar(entry, STATES.CONNECTED, { op: 'receive_done', origem: 'ConnectionManager.receive' });
      }
    }
  }

  async ping(opcoes = {}) {
    const alvo = await this._normalizarOpcoes(opcoes);
    let entry = this.getConnection(alvo);
    if (!entry || !entry.fsm.ativo) {
      // Auto-connect para ping por id
      if (alvo.equipamentoId || (alvo.host && alvo.porta)) {
        await this.connect(alvo);
        entry = this.getConnection(alvo);
      }
    }
    if (!entry || !entry.transport) {
      return { ok: false, status: 'DISCONNECTED', latencia: null };
    }
    const inicio = Date.now();
    const r = await entry.transport.ping();
    const latencia = r?.latencia != null ? r.latencia : (Date.now() - inicio);
    if (r?.ok) {
      entry.metrics.registrarHeartbeat(true, { latencia });
      entry.health.latencia = latencia;
      entry.health.touch();
      this._ensureSession(entry)?.touchHeartbeat(latencia, CONNECTION_MODE.REUSED_SESSION);
    }
    this.events.emitHeartbeat({
      host: entry.host,
      porta: entry.porta,
      ok: Boolean(r?.ok),
      latencia,
      manual: true,
      connectionMode: CONNECTION_MODE.REUSED_SESSION
    });
    return {
      ok: Boolean(r?.ok),
      status: entry.fsm.estado,
      latencia,
      estado: entry.fsm.estado,
      session: entry.session ? entry.session.snapshot() : null
    };
  }

  getConnection(opcoes = {}) {
    if (!opcoes || typeof opcoes !== 'object') return null;
    if (opcoes.equipamentoId != null || opcoes.equipamento_id != null || opcoes.id != null) {
      const found = this.pool.get({
        equipamentoId: opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id
      });
      if (found) return found;
    }
    if (opcoes.host || opcoes.ip) {
      return this.pool.get(opcoes.host || opcoes.ip, opcoes.porta || opcoes.porta_tcp);
    }
    if (opcoes.porta_com) return this.pool.get({ porta_com: opcoes.porta_com });
    return this.pool.get(opcoes);
  }

  /** Compat V1 — acesso ao TcpConnection. */
  getTcp(opcoes = {}) {
    const entry = this.getConnection(opcoes);
    if (!entry) return null;
    if (entry.tcp) return entry.tcp;
    if (entry.transport && typeof entry.transport.getTcp === 'function') {
      return entry.transport.getTcp();
    }
    return null;
  }

  health(opcoes = {}) {
    const entry = this.getConnection(opcoes);
    if (!entry) {
      // RC14.14.9 — NÃO criar sessão fantasma (host=null) em leitura
      const session = sessionRegistry.get(opcoes)
        || new EquipmentSession({
          host: opcoes.host || opcoes.ip || null,
          porta: opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp,
          equipamentoId: opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id
        });
      const blocos = session.toConexaoMonitor();
      return {
        ...new ConnectionHealth({ status: STATUS.OFFLINE }).paraApi(),
        estado: session.connected ? STATES.CONNECTED : STATES.DISCONNECTED,
        metricas: new ConnectionMetrics().snapshot(),
        session: blocos.session,
        conexao: blocos.conexao,
        monitor: blocos.monitor,
        connected: session.connected === true
      };
    }
    if (!entry.transport?.aberto && entry.fsm.ativo) {
      this._transitar(entry, STATES.DISCONNECTED, {
        motivo: 'socket_caiu',
        connectionMode: CONNECTION_MODE.DISCONNECTED
      });
    }
    this._ensureSession(entry);
    this._syncSession(entry, {});
    const api = entry.health.paraApi();
    const blocos = entry.session.toConexaoMonitor();
    return {
      ...api,
      status: entry.fsm.ativo ? 'CONNECTED' : (entry.fsm.estado === STATES.CONNECTING || entry.fsm.estado === STATES.RECONNECTING
        ? entry.fsm.estado
        : (entry.fsm.estado === STATES.ERROR ? 'ERROR' : api.status)),
      estado: entry.fsm.estado,
      transporte: entry.transporte,
      equipamentoId: entry.equipamentoId,
      metricas: entry.metrics.snapshot(),
      socket: Boolean(entry.transport?.aberto),
      heartbeat: entry.heartbeat?.ativo === true,
      ultimoHeartbeat: entry.metrics.ultimoHeartbeat,
      connected: entry.session.connected,
      connectionMode: entry.session.connectionMode,
      session: blocos.session,
      conexao: blocos.conexao,
      monitor: blocos.monitor
    };
  }

  /**
   * RC14.14.7 / RC14.14.9 — snapshot da ÚNICA EquipmentSession do alvo.
   * Em leitura sem entry: usa registry; sem criar fantasma com host=null.
   */
  getSessionSnapshot(opcoes = {}) {
    const entry = this.getConnection(opcoes);
    if (entry) {
      this._ensureSession(entry);
      this._syncSession(entry, {});
      return entry.session.toConexaoMonitor();
    }
    const session = sessionRegistry.get(opcoes);
    if (session) return session.toConexaoMonitor();
    // Snapshot efêmero (não registra) — evita polluir registry com host=null
    return new EquipmentSession({
      host: opcoes.host || opcoes.ip || null,
      porta: opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp,
      equipamentoId: opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id
    }).toConexaoMonitor();
  }

  /**
   * Referência viva da sessão oficial.
   * Com entry no pool: sempre a sessão bindada.
   * Sem entry: registry existente, ou cria só quando há host/porta ou id.
   */
  getSession(opcoes = {}) {
    const entry = this.getConnection(opcoes);
    if (entry) return this._ensureSession(entry);
    const existing = sessionRegistry.get(opcoes);
    if (existing) return existing;
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    const id = opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id;
    if (host && porta != null) return sessionRegistry.getOrCreate(opcoes);
    if (id != null) return sessionRegistry.getOrCreate(opcoes);
    return null;
  }

  latency(opcoes = {}) {
    const entry = this.getConnection(opcoes);
    return entry ? entry.health.latencia : null;
  }

  listConnections() {
    return this.pool.entries().map(([key, entry]) => ({
      key,
      equipamentoId: entry.equipamentoId,
      host: entry.host,
      porta: entry.porta,
      porta_com: entry.porta_com,
      transporte: entry.transporte,
      estado: entry.fsm.estado,
      status: entry.fsm.ativo ? 'CONNECTED' : entry.fsm.estado,
      latencia: entry.health.latencia,
      socket: Boolean(entry.transport?.aberto),
      heartbeat: entry.heartbeat?.ativo === true,
      metricas: entry.metrics.snapshot()
    }));
  }

  async closeAll() {
    const lista = this.pool.entries().map(([, e]) => e);
    for (const entry of lista) {
      try {
        await this.disconnect({
          equipamentoId: entry.equipamentoId,
          host: entry.host,
          porta: entry.porta,
          porta_com: entry.porta_com,
          force: true
        });
      } catch (_) { /* ignore */ }
    }
    this.pool.clear();
    return { fechadas: lista.length };
  }
}

const connectionManager = new ConnectionManager();

module.exports = connectionManager;
module.exports.ConnectionManager = ConnectionManager;
module.exports.BACKOFF_MS = BACKOFF_MS;
module.exports.STATES = STATES;
module.exports.EVENTS = EVENTS;
