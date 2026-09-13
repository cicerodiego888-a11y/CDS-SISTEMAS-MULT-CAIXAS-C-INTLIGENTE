'use strict';

/**
 * Probe de Heartbeat — RC3.1 + RC14.14.8 + RC15.10
 * Preferência: ping via ConnectionManager (sessão persistente).
 * Nunca chama disconnect() em sessão busy / connected+persistent.
 * Fallback efêmero usa socket próprio (não toca o pool do CM).
 */

const net = require('net');
const { TIPO_TESTE } = require('./HeartbeatProfile');
const {
  deveSuspenderHeartbeat,
  podeHeartbeatDisconnect
} = require('../connection/SessionBusy');

/**
 * @param {Object} equipamento
 * @param {Object} perfil
 * @returns {Promise<{ sucesso: boolean, timeout: boolean, latencia_ms: number|null, erro: string|null, tipo_teste: string, comunicacao_real: boolean }>}
 */
async function executarProbe(equipamento, perfil) {
  const tipo = perfil.tipo_teste || TIPO_TESTE.TCP_CONNECT;
  const timeoutMs = Number(perfil.timeout_ms || 3000);
  const transporte = String(equipamento.transporte || '').toLowerCase();

  if (transporte === 'ethernet' || (!transporte && equipamento.ip)) {
    return probeEthernet(equipamento, timeoutMs, tipo);
  }

  return {
    sucesso: false,
    timeout: false,
    latencia_ms: null,
    erro: `Heartbeat ${transporte || 'desconhecido'}: probe físico não habilitado nesta RC`,
    tipo_teste: tipo,
    comunicacao_real: false,
    skip: false
  };
}

function _alvo(equipamento) {
  const host = equipamento.ip || equipamento.host;
  const porta = equipamento.porta_tcp || equipamento.porta
    || require('../drivers/toledo/ToledoProtocol').PORTA_PADRAO;
  return {
    host,
    porta,
    equipamentoId: equipamento.id != null ? Number(equipamento.id) : null
  };
}

function _obterCm() {
  try {
    return require('../connection/ConnectionManager');
  } catch (_) {
    return null;
  }
}

async function probeViaConnectionManager(equipamento, timeoutMs, tipo) {
  const cm = _obterCm();
  if (!cm || typeof cm.ping !== 'function') return null;

  const alvo = _alvo(equipamento);
  if (!alvo.host || !alvo.porta) return null;

  const session = typeof cm.getSession === 'function' ? cm.getSession(alvo) : null;
  if (deveSuspenderHeartbeat(session)) {
    return {
      sucesso: true,
      timeout: false,
      latencia_ms: session?.latency != null ? Number(session.latency) : null,
      erro: null,
      tipo_teste: tipo,
      comunicacao_real: true,
      reused_session: true,
      skipped: true,
      motivo: 'session_busy'
    };
  }

  const entry = typeof cm.getConnection === 'function' ? cm.getConnection(alvo) : null;
  const socketAberto = Boolean(entry?.transport?.aberto || entry?.tcp?.aberto);
  const sessaoViva = Boolean(
    session?.connected
    || session?.persistent
    || socketAberto
    || (typeof cm.isConnected === 'function' && cm.isConnected(alvo))
  );
  if (!sessaoViva) return null;

  const inicio = Date.now();
  try {
    const r = await cm.ping({ ...alvo, timeoutMs });
    const latencia = r?.latencia != null ? Number(r.latencia) : (Date.now() - inicio);
    if (r && r.ok === false) {
      return {
        sucesso: false,
        timeout: false,
        latencia_ms: latencia,
        erro: r.erro || r.message || 'ping falhou',
        tipo_teste: tipo,
        comunicacao_real: true,
        reused_session: true
      };
    }

    try {
      if (session && typeof session.touchHeartbeat === 'function') {
        session.touchHeartbeat(latencia, 'REUSED_SESSION');
      }
    } catch (_) { /* ignore */ }

    return {
      sucesso: true,
      timeout: false,
      latencia_ms: latencia,
      erro: null,
      tipo_teste: tipo,
      comunicacao_real: true,
      reused_session: true
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      sucesso: false,
      timeout: /timeout|ETIMEDOUT|timed out/i.test(msg),
      latencia_ms: Date.now() - inicio,
      erro: msg,
      tipo_teste: tipo,
      comunicacao_real: true,
      reused_session: true
    };
  }
}

/**
 * Probe TCP efêmero — socket próprio, NÃO usa ConnectionManager.disconnect.
 */
function probeEphemeralTcp(host, porta, timeoutMs) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) { /* ignore */ }
      resolve(payload);
    };

    const timer = setTimeout(() => {
      finish({
        sucesso: false,
        timeout: true,
        latencia_ms: Date.now() - inicio,
        erro: 'Timeout de conexão TCP (probe efêmero)',
        comunicacao_real: true,
        reused_session: false
      });
    }, Math.max(200, Number(timeoutMs) || 3000));

    socket.once('connect', () => {
      clearTimeout(timer);
      finish({
        sucesso: true,
        timeout: false,
        latencia_ms: Date.now() - inicio,
        erro: null,
        comunicacao_real: true,
        reused_session: false
      });
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      finish({
        sucesso: false,
        timeout: /timeout|ETIMEDOUT/i.test(err?.message || ''),
        latencia_ms: Date.now() - inicio,
        erro: err?.message || String(err),
        comunicacao_real: true,
        reused_session: false
      });
    });

    try {
      socket.connect(Number(porta), String(host));
    } catch (err) {
      clearTimeout(timer);
      finish({
        sucesso: false,
        timeout: false,
        latencia_ms: Date.now() - inicio,
        erro: err?.message || String(err),
        comunicacao_real: true,
        reused_session: false
      });
    }
  });
}

async function probeEthernet(equipamento, timeoutMs, tipo) {
  if (!equipamento.ip && !equipamento.host) {
    return {
      sucesso: false,
      timeout: false,
      latencia_ms: null,
      erro: 'Equipamento sem IP',
      tipo_teste: tipo,
      comunicacao_real: false
    };
  }

  const cm = _obterCm();
  const alvo = _alvo(equipamento);
  const session = cm && typeof cm.getSession === 'function' ? cm.getSession(alvo) : null;

  // RC15.10 — operação ativa: heartbeat suspende (sem disconnect)
  if (deveSuspenderHeartbeat(session)) {
    return {
      sucesso: true,
      timeout: false,
      latencia_ms: session?.latency != null ? Number(session.latency) : null,
      erro: null,
      tipo_teste: tipo,
      comunicacao_real: true,
      reused_session: true,
      skipped: true,
      motivo: 'session_busy'
    };
  }

  // RC15.10 / RC14.14.8 — sessão viva: só ping (nunca disconnect)
  const viaCm = await probeViaConnectionManager(equipamento, timeoutMs, tipo);
  if (viaCm) return { ...viaCm, tipo_teste: tipo };

  if (!podeHeartbeatDisconnect(session)) {
    // connected+persistent mas ping indisponível — não derruba sessão
    return {
      sucesso: Boolean(session?.connected),
      timeout: false,
      latencia_ms: session?.latency != null ? Number(session.latency) : null,
      erro: session?.connected ? null : 'Sessão persistente — heartbeat sem disconnect',
      tipo_teste: tipo,
      comunicacao_real: true,
      reused_session: true,
      skipped: true,
      motivo: 'persistent_no_disconnect'
    };
  }

  // Sem sessão no pool: probe efêmero com socket próprio (não toca CM)
  const ephemeral = await probeEphemeralTcp(alvo.host, alvo.porta, timeoutMs);
  return { ...ephemeral, tipo_teste: tipo };
}

module.exports = {
  executarProbe,
  probeEthernet,
  probeEphemeralTcp,
  /** @deprecated — mantido para testes que mockam path antigo */
  podeHeartbeatDisconnect
};
