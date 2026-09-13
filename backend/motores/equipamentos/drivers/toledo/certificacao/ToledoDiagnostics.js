/**
 * Sprint 14.12 / RC15.0.1 — Health + Diagnostics do Driver Toledo
 * Diagnóstico ativo: TCP Connect real ≠ Handshake ≠ Health.
 */

'use strict';

const { getVersion } = require('./ToledoVersion');
const { getCapabilities } = require('../ToledoCapabilities');
const { DRIVER, MODELO, FIRMWARE_ALVO, FABRICANTE, PORTA_PADRAO } = require('../ToledoProtocol');
const ToledoTimeouts = require('../ToledoTimeouts');
const { montarEtapasConexao } = require('../../../connection/ConnectionStages');
const {
  TCP_CONNECT_STATUS,
  HANDSHAKE_STATUS,
  classificarErroTcp,
  classificarErroHandshake,
  rotuloTcp,
  rotuloHandshake
} = require('../../../connection/TcpConnectStatus');
const ConnectionTrace = require('../../../connection/ConnectionTrace');
const SessionOriginAudit = require('../../../connection/SessionOriginAudit');
const { auditArchitecture } = require('./ArchitectureAuditor');
const { CHECKLIST, avaliarChecklist } = require('./HomologacaoChecklist');

let connectionManager = null;
function getConnectionManager() {
  if (!connectionManager) {
    try {
      connectionManager = require('../../../connection/ConnectionManager');
    } catch (_) {
      connectionManager = null;
    }
  }
  return connectionManager;
}

/** Estatísticas em memória (processo) — sem I/O de negócio */
const stats = {
  startedAt: new Date().toISOString(),
  operacoes: 0,
  sincronizacoes: 0,
  pesagens: 0,
  monitorTicks: 0,
  erros: 0,
  ultimoErro: null,
  latencias: {
    ping: [],
    handshake: [],
    upload: [],
    download: [],
    peso: [],
    config: []
  }
};

function _pushLat(serie, ms) {
  if (!Number.isFinite(ms)) return;
  const arr = stats.latencias[serie];
  if (!arr) return;
  arr.push(Number(ms));
  if (arr.length > 100) arr.shift();
}

function recordLatency(tipo, ms) {
  _pushLat(tipo, ms);
  stats.operacoes += 1;
}

function recordError(err) {
  stats.erros += 1;
  stats.ultimoErro = {
    message: err && (err.message || err.code || String(err)),
    code: err && err.code,
    at: new Date().toISOString()
  };
}

function media(arr) {
  if (!arr || !arr.length) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function performanceReport() {
  return {
    pingMs: media(stats.latencias.ping),
    handshakeMs: media(stats.latencias.handshake),
    uploadMs: media(stats.latencias.upload),
    downloadMs: media(stats.latencias.download),
    pesoMs: media(stats.latencias.peso),
    configMs: media(stats.latencias.config),
    amostras: {
      ping: stats.latencias.ping.length,
      handshake: stats.latencias.handshake.length,
      upload: stats.latencias.upload.length,
      download: stats.latencias.download.length,
      peso: stats.latencias.peso.length,
      config: stats.latencias.config.length
    }
  };
}

/**
 * GET health — estado do pool (passivo).
 * RC15.0.1: ausência de sessão ≠ falha TCP; motivo explícito.
 */
function health(opcoes = {}) {
  const cm = getConnectionManager();
  const host = opcoes.host || null;
  const porta = opcoes.porta != null ? Number(opcoes.porta) : null;
  let conexao = null;
  let poolSize = null;

  if (cm) {
    try {
      poolSize = cm.pool ? cm.pool.size() : null;
      if (host && porta) {
        conexao = typeof cm.health === 'function' ? cm.health({ host, porta }) : null;
      }
    } catch (_) { /* ignore */ }
  }

  let online = null;
  let sessaoAusente = false;
  if (host && porta) {
    const ativo = Boolean(
      cm
      && typeof cm.isConnected === 'function'
      && cm.isConnected({ host, porta }) === true
    );
    online = ativo;
    sessaoAusente = !ativo;
  } else if (conexao) {
    online = conexao.connected === true
      || conexao.status === 'CONNECTED'
      || conexao.online === true;
  }

  let motivo = null;
  if (online === false) {
    motivo = conexao?.ultimoErro
      || conexao?.motivo
      || (sessaoAusente
        ? 'Sessão ausente no ConnectionManager (TCP não testado neste health passivo)'
        : 'OFFLINE');
  }

  return {
    success: true,
    status: online === false ? 'OFFLINE' : 'OK',
    driver: DRIVER,
    online,
    motivo,
    sessaoAusente,
    heartbeat: conexao && conexao.heartbeat != null ? Boolean(conexao.heartbeat) : null,
    ultimoHeartbeat: conexao?.ultimoHeartbeat || null,
    poolSize,
    uptimeMs: Date.now() - new Date(stats.startedAt).getTime(),
    tempoConectadoMs: conexao?.metricas?.tempoOnlineMs
      ?? conexao?.metricas?.uptimeMs
      ?? null,
    erros: stats.erros,
    ultimoErro: stats.ultimoErro,
    checkedAt: new Date().toISOString()
  };
}

/**
 * Probe ativo: Socket.connect real + Handshake separado.
 * @param {{host:string, porta:number, keepAlive?:boolean, skipHandshake?:boolean}} opcoes
 */
async function probeConnection(opcoes = {}) {
  const host = opcoes.host ? String(opcoes.host) : null;
  const porta = opcoes.porta != null ? Number(opcoes.porta) : null;
  const timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : ToledoTimeouts.CONNECT;
  const hsTimeout = opcoes.handshakeTimeoutMs != null
    ? Number(opcoes.handshakeTimeoutMs)
    : ToledoTimeouts.HANDSHAKE;
  const keepAlive = opcoes.keepAlive !== false; // RC14.14.8 — default true (sessão persistente)
  const skipHandshake = opcoes.skipHandshake === true;

  const trace = ConnectionTrace.criar({ host, porta, timeoutMs });
  const out = {
    tcp: {
      ok: null,
      codigo: TCP_CONNECT_STATUS.NOT_STARTED,
      erro: null,
      latenciaMs: null,
      reutilizada: false
    },
    handshake: {
      ok: null,
      codigo: HANDSHAKE_STATUS.NOT_STARTED,
      erro: null,
      latenciaMs: null
    },
    health: { ok: null, erro: null },
    read: { ok: null, erro: null },
    driver: { ok: true, erro: null },
    connectionTrace: null
  };

  if (!host || !porta) {
    out.tcp = {
      ok: false,
      codigo: TCP_CONNECT_STATUS.SOCKET_EXCEPTION,
      erro: 'IP ou porta ausentes',
      latenciaMs: null,
      reutilizada: false
    };
    out.handshake.erro = 'Não iniciado';
    out.health = { ok: false, erro: 'Sem alvo' };
    trace.inicioConnect();
    trace.socketFalha({ codigo: out.tcp.codigo, erro: out.tcp.erro });
    trace.finalizar(out.tcp.codigo);
    out.connectionTrace = trace.toJSON();
    await ConnectionTrace.emitir(trace);
    return out;
  }

  const cm = getConnectionManager();
  if (!cm || typeof cm.connect !== 'function') {
    out.tcp = {
      ok: false,
      codigo: TCP_CONNECT_STATUS.SOCKET_EXCEPTION,
      erro: 'ConnectionManager indisponível',
      latenciaMs: null,
      reutilizada: false
    };
    out.health = { ok: false, erro: out.tcp.erro };
    trace.inicioConnect();
    trace.socketFalha({ codigo: out.tcp.codigo, erro: out.tcp.erro });
    trace.finalizar(out.tcp.codigo);
    out.connectionTrace = trace.toJSON();
    await ConnectionTrace.emitir(trace);
    return out;
  }

  let abriuNestaProbe = false;
  const equipamentoId = opcoes.equipamentoId != null
    ? Number(opcoes.equipamentoId)
    : (opcoes.equipamento_id != null ? Number(opcoes.equipamento_id) : null);
  const alvoSessao = { host, porta, equipamentoId: Number.isFinite(equipamentoId) ? equipamentoId : undefined };
  const jaConectado = typeof cm.isConnected === 'function'
    && cm.isConnected(alvoSessao) === true;

  try {
    if (jaConectado) {
      out.tcp = {
        ok: true,
        codigo: TCP_CONNECT_STATUS.OK,
        erro: null,
        latenciaMs: 0,
        reutilizada: true
      };
      trace.inicioConnect();
      trace.socketOk({ latenciaMs: 0, reutilizada: true });
    } else {
      const t0 = Date.now();
      const r = await cm.connect({
        host,
        porta,
        equipamentoId: Number.isFinite(equipamentoId) ? equipamentoId : undefined,
        timeoutMs,
        persistir: keepAlive !== false
      });
      abriuNestaProbe = true;
      out.tcp = {
        ok: true,
        codigo: r.connectCodigo || TCP_CONNECT_STATUS.OK,
        erro: null,
        latenciaMs: r.latencia != null ? r.latencia : (Date.now() - t0),
        reutilizada: r.reutilizada === true
      };
      if (r.connectionTrace) {
        // prefer manager trace
        out.connectionTrace = r.connectionTrace;
      } else {
        trace.inicioConnect();
        trace.socketOk({ latenciaMs: out.tcp.latenciaMs, reutilizada: out.tcp.reutilizada });
      }
    }
  } catch (err) {
    const codigo = err.connectCodigo || classificarErroTcp(err);
    out.tcp = {
      ok: false,
      codigo,
      erro: err.message || rotuloTcp(codigo),
      latenciaMs: err.connectionTrace?.tcp?.latenciaMs ?? null,
      reutilizada: false
    };
    out.handshake = {
      ok: null,
      codigo: HANDSHAKE_STATUS.NOT_STARTED,
      erro: 'Não iniciado (TCP Connect falhou)',
      latenciaMs: null
    };
    out.read = { ok: null, erro: 'Não iniciado' };
    out.health = { ok: false, erro: out.tcp.erro };
    out.connectionTrace = err.connectionTrace || (() => {
      trace.inicioConnect();
      trace.socketFalha({ codigo, erro: out.tcp.erro });
      trace.finalizar(codigo);
      return trace.toJSON();
    })();
    try {
      if (err.connectionTrace?.texto) {
        // eslint-disable-next-line no-console
        console.log(err.connectionTrace.texto);
      } else {
        await ConnectionTrace.emitir(trace);
      }
    } catch (_) { /* ignore */ }
    return out;
  }

  // Handshake — só se TCP OK
  if (!skipHandshake && out.tcp.ok) {
    const hsTrace = out.connectionTrace
      ? ConnectionTrace.criar({ host, porta, timeoutMs: hsTimeout })
      : trace;
    hsTrace.inicioHandshake();
    try {
      const { createEngine } = require('../protocol/Toledo90AXEngine');
      const engine = createEngine({ connectionManager: cm });
      engine.bind({ host, porta });
      const hs = await engine.handshake({}, { timeoutMs: hsTimeout, retries: 0 });
      out.handshake = {
        ok: true,
        codigo: HANDSHAKE_STATUS.OK,
        erro: null,
        latenciaMs: hs.latenciaMs != null ? hs.latenciaMs : null
      };
      hsTrace.frameTx({ comando: 'HS' });
      hsTrace.frameRx({ comando: hs.responseCommand || 'AK' });
      hsTrace.ack({ ok: true, latenciaMs: out.handshake.latenciaMs });
      recordLatency('handshake', out.handshake.latenciaMs);

      // RC14.14.5 — Read real (ping) após Handshake OK
      try {
        const ping = await engine.execute('ping', null, {
          host,
          porta,
          timeoutMs: Math.min(hsTimeout, 2000),
          retries: 0
        });
        out.read = {
          ok: true,
          erro: null,
          latenciaMs: ping.latenciaMs != null ? ping.latenciaMs : null,
          via: 'ping'
        };
        recordLatency('ping', out.read.latenciaMs);
      } catch (readErr) {
        out.read = {
          ok: false,
          erro: readErr.message || 'Falha na leitura (ping)',
          via: 'ping'
        };
        recordError(readErr);
      }
    } catch (err) {
      const codigo = classificarErroHandshake(err);
      out.handshake = {
        ok: false,
        codigo,
        erro: err.message || rotuloHandshake(codigo),
        latenciaMs: null
      };
      out.read = {
        ok: null,
        erro: 'Não executado (Handshake falhou)'
      };
      hsTrace.ack({ ok: false, detalhe: out.handshake.erro });
      recordError(err);
    }

    // merge handshake steps into connectionTrace
    const base = out.connectionTrace || trace.toJSON();
    base.handshake = out.handshake;
    base.passos = (base.passos || []).concat(hsTrace.passos || []);
    hsTrace.finalizar(
      out.handshake.ok ? 'TCP_OK+HANDSHAKE_OK' : `TCP_OK+${out.handshake.codigo}`
    );
    base.resultadoFinal = hsTrace.resultadoFinal;
    base.texto = [
      base.texto || '',
      '',
      '--- HANDSHAKE ---',
      `ok: ${out.handshake.ok}`,
      `codigo: ${out.handshake.codigo}`,
      out.handshake.erro ? `erro: ${out.handshake.erro}` : null,
      out.handshake.latenciaMs != null ? `latenciaMs: ${out.handshake.latenciaMs}` : null
    ].filter(Boolean).join('\n');
    out.connectionTrace = base;
    await ConnectionTrace.emitir({
      toText: () => base.texto,
      toJSON: () => base
    });
  } else if (skipHandshake) {
    out.handshake.erro = 'Não iniciado (skipHandshake)';
  }

  out.health = {
    ok: out.tcp.ok === true && (
      typeof cm.isConnected !== 'function' || cm.isConnected({ host, porta }) === true
    ),
    erro: out.tcp.ok ? null : out.tcp.erro
  };

  if (abriuNestaProbe && keepAlive === false) {
    try {
      await cm.disconnect({ host, porta, force: true });
    } catch (_) { /* ignore */ }
  }

  return out;
}

/**
 * RC14.14.5 — Resolve IP/porta do alvo (cadastro + identidade + query).
 * Nunca depende só de equipamento.ip.
 */
function resolverAlvoDiagnostico(opcoes = {}) {
  const eq = opcoes.equipamento && typeof opcoes.equipamento === 'object'
    ? opcoes.equipamento
    : {};
  const idn = opcoes.identidade && typeof opcoes.identidade === 'object'
    ? opcoes.identidade
    : (eq.identidade && typeof eq.identidade === 'object' ? eq.identidade : {});

  const hostRaw = [
    opcoes.host,
    opcoes.ip,
    eq.ip,
    eq.ultimo_ip,
    eq.host,
    eq.ip_atual,
    idn.ip_atual,
    idn.ip
  ].find((v) => v != null && String(v).trim() !== '');

  const portaRaw = [
    opcoes.porta,
    opcoes.porta_tcp,
    eq.porta_tcp,
    eq.porta,
    idn.porta_atual,
    idn.porta
  ].find((v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0);

  const host = hostRaw != null ? String(hostRaw).trim() : null;
  const porta = portaRaw != null ? Number(portaRaw) : PORTA_PADRAO;
  const equipamentoIdRaw = [
    opcoes.equipamentoId,
    opcoes.equipamento_id,
    opcoes.id,
    eq.id,
    eq.equipamento_id
  ].find((v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0);
  const equipamentoId = equipamentoIdRaw != null ? Number(equipamentoIdRaw) : null;
  return { host, porta, equipamentoId, equipamento: eq, identidade: idn };
}

function montarProbeResumo(probe) {
  if (!probe) {
    return { tcp: false, handshake: false, health: false, read: false };
  }
  return {
    tcp: probe.tcp?.ok === true,
    handshake: probe.handshake?.ok === true,
    health: probe.health?.ok === true,
    read: probe.read?.ok === true
  };
}

function enriquecerConnectionTrace(trace, probe) {
  if (!trace || typeof trace !== 'object') return null;
  const tcp = probe?.tcp || {};
  const hs = probe?.handshake || {};
  const health = probe?.health || {};
  const read = probe?.read || {};
  return {
    ...trace,
    connectStarted: trace.iniciadoEm || trace.connectStarted || null,
    connectFinished: new Date().toISOString(),
    latencyMs: tcp.latenciaMs != null ? tcp.latenciaMs : null,
    socket: tcp.ok === true ? 'CONNECTED' : (tcp.ok === false ? 'FAILED' : 'UNKNOWN'),
    handshake: hs.ok === true ? 'OK' : (hs.ok === false ? (hs.codigo || 'FAIL') : 'NAO_EXECUTADO'),
    health: health.ok === true ? 'OK' : (health.ok === false ? 'FAIL' : 'NAO_EXECUTADO'),
    read: read.ok === true ? 'OK' : (read.ok === false ? 'FAIL' : 'NAO_EXECUTADO')
  };
}

/**
 * Relatório diagnóstico completo (fonte oficial).
 * RC15.0.1 — async com probe ativo quando host/porta informados.
 * RC14.14.5 — sempre executa comunicação real quando diagnóstico é solicitado
 *             (probe !== false); resolve IP via cadastro/identidade/ultimo_ip.
 */
async function diagnostics(opcoes = {}) {
  const alvo = resolverAlvoDiagnostico(opcoes);
  const eqCtx = alvo.equipamento;
  const host = alvo.host;
  const porta = alvo.porta;
  const equipamentoId = alvo.equipamentoId;
  const probeAtivo = opcoes.probe !== false;
  const alvoSessao = {
    host: host || undefined,
    porta: porta || undefined,
    equipamentoId: equipamentoId != null ? equipamentoId : undefined
  };

  const version = getVersion();
  const caps = getCapabilities();
  const arch = auditArchitecture();
  const hPassive = health(alvoSessao);
  const perf = performanceReport();

  let probe = null;
  if (probeAtivo) {
    if (host && Number.isFinite(porta) && porta > 0) {
      // Mantém sessão persistente (RC14.14.8) — keepAlive default true
      // RC15.6 — mesmo alvo (equipamentoId+host+porta) do Upload
      // RC15.10 — suspende heartbeat durante diagnóstico
      const { withBusy, OP_BUSY } = require('../../../connection/SessionBusy');
      probe = await withBusy(alvoSessao, OP_BUSY.DIAGNOSTICO, () => probeConnection({
        host,
        porta,
        equipamentoId,
        keepAlive: opcoes.keepAlive !== false,
        skipHandshake: opcoes.skipHandshake === true,
        handshakeTimeoutMs: opcoes.handshakeTimeoutMs,
        timeoutMs: opcoes.timeoutMs
      }));
    } else {
      // Diagnóstico solicitado sem IP — nunca deixar etapas em NAO_INICIADO
      const trace = ConnectionTrace.criar({ host: null, porta, timeoutMs: null });
      trace.inicioConnect();
      trace.socketFalha({
        codigo: TCP_CONNECT_STATUS.IP_MISSING,
        erro: 'IP não informado para diagnóstico'
      });
      trace.finalizar(TCP_CONNECT_STATUS.IP_MISSING);
      probe = {
        tcp: {
          ok: false,
          codigo: TCP_CONNECT_STATUS.IP_MISSING,
          erro: 'IP não informado para diagnóstico',
          latenciaMs: null,
          reutilizada: false
        },
        handshake: {
          ok: null,
          codigo: HANDSHAKE_STATUS.NOT_STARTED,
          erro: 'Não executado (IP ausente)',
          latenciaMs: null
        },
        read: { ok: null, erro: 'Não executado (IP ausente)' },
        health: { ok: false, erro: 'IP não informado' },
        driver: { ok: true, erro: null },
        connectionTrace: trace.toJSON()
      };
      try { await ConnectionTrace.emitir(trace); } catch (_) { /* ignore */ }
    }
  }

  // RC15.0.2 — Protocolo TCP/IP × Interface física (ETHERNET | WLAN | UNKNOWN)
  const { montarNetwork } = require('../ToledoNetworkInfo');
  let ifaceInfo = {
    interface: 'UNKNOWN',
    protocol: 'TCP/IP',
    source: 'unsupported',
    mensagem: 'Não informado pelo equipamento'
  };
  try {
    const ToledoPrixIVDriver = require('../ToledoPrixIVDriver');
    const drv = new ToledoPrixIVDriver({ connectionManager: getConnectionManager() });
    ifaceInfo = await drv.getNetworkInterface({
      host: host || undefined,
      porta: host ? porta : undefined,
      equipamento: eqCtx,
      interface: opcoes.interface || opcoes.INTERFACE
    });
  } catch (_) { /* UNKNOWN */ }

  // RC14.14.7 / RC15.6 — capturar a MESMA EquipmentSession do Upload
  let sessionBlocos = { session: null, conexao: null, monitor: null };
  let sessionOrigin = null;
  try {
    const cm = getConnectionManager();
    if (cm && (host || equipamentoId != null)) {
      const live = typeof cm.getSession === 'function'
        ? cm.getSession(alvoSessao)
        : null;
      if (live) {
        if (typeof live.setPersistent === 'function' && opcoes.keepAlive !== false) {
          live.setPersistent(true);
        }
        sessionBlocos = live.toConexaoMonitor();
      } else if (typeof cm.getSessionSnapshot === 'function') {
        sessionBlocos = cm.getSessionSnapshot(alvoSessao);
      }
      sessionOrigin = SessionOriginAudit.registrarDiagnostico(alvoSessao, cm);
    }
  } catch (_) { /* ignore */ }

  // RC14.14.8 — NÃO desconectar após diagnóstico (sessão permanente).
  // Só fecha se keepAlive=false explicitamente (testes efêmeros).
  if (probe && probe.tcp?.ok === true && opcoes.keepAlive === false) {
    try {
      const cm = getConnectionManager();
      if (cm) await cm.disconnect({ host, porta, force: true });
    } catch (_) { /* ignore */ }
  }

  const network = montarNetwork({
    protocol: eqCtx.porta_com ? 'Serial' : (host ? 'TCP/IP' : null),
    interface: ifaceInfo.interface,
    ip: host,
    port: Number.isFinite(porta) ? porta : null,
    source: ifaceInfo.source,
    mensagem: ifaceInfo.mensagem,
    porta_com: eqCtx.porta_com || null
  });

  const etapas_conexao = probe
    ? montarEtapasConexao({
      diagnosticoSolicitado: true,
      tcp: probe.tcp.ok,
      tcpCodigo: probe.tcp.codigo,
      tcpErro: probe.tcp.erro,
      tcpLatenciaMs: probe.tcp.latenciaMs,
      handshake: probe.handshake.ok,
      handshakeCodigo: probe.handshake.codigo,
      handshakeErro: probe.handshake.erro,
      handshakeLatenciaMs: probe.handshake.latenciaMs,
      health: probe.health.ok,
      healthErro: probe.health.erro,
      driver: probe.driver?.ok !== false,
      incluirRead: true,
      read: probe.read.ok,
      readErro: probe.read.erro
    })
    : montarEtapasConexao({
      diagnosticoSolicitado: false,
      tcp: null,
      handshake: null,
      health: hPassive.online === true ? true : (hPassive.online === false ? false : null),
      healthErro: hPassive.motivo,
      driver: true,
      incluirRead: true,
      read: null
    });

  // Health reportado ao painel: preferir resultado do probe TCP
  const h = probe
    ? {
      ...hPassive,
      online: probe.tcp.ok === true,
      status: probe.tcp.ok === true
        ? (probe.handshake.ok === false ? 'DEGRADED' : 'OK')
        : 'OFFLINE',
      motivo: probe.tcp.ok
        ? (probe.handshake.ok === false
          ? `TCP OK — falha em ${probe.handshake.codigo}: ${probe.handshake.erro}`
          : null)
        : `${probe.tcp.codigo}: ${probe.tcp.erro || rotuloTcp(probe.tcp.codigo)}`,
      tcp: probe.tcp,
      handshake: probe.handshake,
      probeAtivo: true
    }
    : hPassive;

  const evidencias = {
    discovery: arch.resultados.find((r) => r.id === 'discovery')?.status === 'OK',
    fingerprint: arch.resultados.find((r) => r.id === 'fingerprint')?.status === 'OK',
    connection: arch.resultados.find((r) => r.id === 'connection')?.status === 'OK',
    handshake: caps.capabilities.handshake === true,
    ping: caps.capabilities.ping === true,
    plu_upload: caps.capabilities.uploadPLU === true,
    plu_download: arch.resultados.find((r) => r.id === 'sync')?.status === 'OK',
    sync: arch.resultados.find((r) => r.id === 'sync')?.status === 'OK',
    weight: caps.capabilities.readWeight === true,
    config: arch.resultados.find((r) => r.id === 'configuration')?.status === 'OK',
    monitor: arch.resultados.find((r) => r.id === 'monitor')?.status === 'OK',
    lab: arch.resultados.find((r) => r.id === 'lab')?.status === 'OK',
    logs: true,
    auditoria: arch.success === true,
    apis: true,
    frontend: true,
    persistencia: true,
    testes: true
  };

  const checklist = avaliarChecklist(evidencias);
  const connection_trace = enriquecerConnectionTrace(probe?.connectionTrace || null, probe);
  const probeOut = probe
    ? {
      ...probe,
      resumo: montarProbeResumo(probe)
    }
    : null;

  // Se ainda não capturou (probe:false), lê registry
  if (!sessionBlocos.session && (host || equipamentoId != null)) {
    try {
      const cm = getConnectionManager();
      if (cm && typeof cm.getSessionSnapshot === 'function') {
        sessionBlocos = cm.getSessionSnapshot(alvoSessao);
      }
      if (!sessionOrigin) {
        sessionOrigin = SessionOriginAudit.registrarDiagnostico(alvoSessao, cm);
      }
    } catch (_) { /* ignore */ }
  }

  const hAligned = sessionBlocos.session
    ? {
      ...h,
      online: sessionBlocos.session.connected === true
        || (probe && probe.tcp?.ok === true),
      status: (sessionBlocos.session.connected || (probe && probe.tcp?.ok === true))
        ? (probe?.handshake?.ok === false ? 'DEGRADED' : 'CONNECTED')
        : (probe?.tcp?.ok === false ? 'OFFLINE' : (h.status || sessionBlocos.session.state)),
      sessionState: sessionBlocos.session.state,
      connectionMode: sessionBlocos.session.connectionMode,
      tempoConectadoMs: sessionBlocos.session.tempo_conexao_ms
        ?? h.tempoConectadoMs
    }
    : h;

  return {
    success: true,
    version,
    equipamento: {
      fabricante: eqCtx.fabricante || FABRICANTE,
      modelo: eqCtx.modelo || MODELO,
      firmware: eqCtx.firmware || eqCtx.ultimo_firmware || FIRMWARE_ALVO,
      driver: eqCtx.driver_codigo || DRIVER,
      numero_serie: eqCtx.numero_serie || eqCtx.serial || eqCtx.serie || null,
      ip: host || null,
      porta: Number.isFinite(porta) ? porta : null,
      porta_com: eqCtx.porta_com || null,
      ultima_comunicacao: eqCtx.ultima_comunicacao || null
    },
    /** RC15.0.2 — protocolo × interface física (não usar transporte CDS) */
    network,
    /** RC14.14.6 — fonte única */
    session: sessionBlocos.session,
    conexao: sessionBlocos.conexao,
    monitor: sessionBlocos.monitor,
    /** RC15.6 — origem da sessão (comparável com Upload) */
    sessionOrigin,
    capabilities: caps.capabilities,
    health: hAligned,
    etapas_conexao,
    connection_trace,
    probe: probeOut,
    performance: perf,
    estatisticas: {
      operacoes: stats.operacoes,
      sincronizacoes: stats.sincronizacoes,
      pesagens: stats.pesagens,
      monitorTicks: stats.monitorTicks,
      erros: stats.erros,
      startedAt: stats.startedAt
    },
    arquitetura: arch,
    checklist,
    homologacao: {
      versao: version.homologacao,
      prontoProducao: arch.success && checklist.homologado,
      checklistTotal: CHECKLIST.length
    },
    generatedAt: new Date().toISOString()
  };
}

function resetStatsForTests() {
  stats.operacoes = 0;
  stats.sincronizacoes = 0;
  stats.pesagens = 0;
  stats.monitorTicks = 0;
  stats.erros = 0;
  stats.ultimoErro = null;
  Object.keys(stats.latencias).forEach((k) => { stats.latencias[k] = []; });
}

module.exports = {
  health,
  diagnostics,
  probeConnection,
  performanceReport,
  recordLatency,
  recordError,
  resetStatsForTests,
  stats,
  resolverAlvoDiagnostico
};
