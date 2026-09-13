/**
 * ConnectionMonitor — RC14.14.1 / RC14.14.6 / RC14.14.7
 * Apenas observa getSession() — mesma referência do ConnectionManager.
 */

'use strict';

const connectionManager = require('../connection/ConnectionManager');
const { PORTA_PADRAO } = require('../drivers/toledo/ToledoProtocol');

function parseAlvo(idOuChave) {
  const s = String(idOuChave || '');
  if (s.includes(':') && !s.startsWith('eq:')) {
    const [host, porta] = s.split(':');
    return { host, porta: Number(porta) || PORTA_PADRAO };
  }
  if (s.startsWith('eq:')) {
    return { equipamentoId: Number(s.slice(3)) };
  }
  const n = Number(s);
  if (Number.isFinite(n)) return { equipamentoId: n };
  return { host: s, porta: PORTA_PADRAO };
}

class ConnectionMonitor {
  obterStatus(idOuChave) {
    const alvo = parseAlvo(idOuChave);
    // RC14.14.7 — nunca new EquipmentSession; só a referência viva
    const live = typeof connectionManager.getSession === 'function'
      ? connectionManager.getSession(alvo)
      : null;
    const blocos = live && typeof live.toConexaoMonitor === 'function'
      ? live.toConexaoMonitor()
      : (typeof connectionManager.getSessionSnapshot === 'function'
        ? connectionManager.getSessionSnapshot(alvo)
        : { session: {}, conexao: {}, monitor: {} });

    const session = blocos.session || {};
    const monitor = blocos.monitor || {};

    return {
      status: monitor.status || session.state || 'DISCONNECTED',
      estado: monitor.estado || session.state || 'DISCONNECTED',
      chave: alvo.host && alvo.porta ? `${alvo.host}:${alvo.porta}` : `eq:${alvo.equipamentoId || ''}`,
      conectado: monitor.conectado === true || session.connected === true,
      desconectado: !(monitor.conectado === true || session.connected === true),
      tempo_conexao_ms: monitor.tempo_conexao || session.tempo_conexao_ms || 0,
      tempo_conexao: monitor.tempo_conexao || session.tempo_conexao_ms || 0,
      latencia: monitor.latencia != null ? monitor.latencia : session.latency,
      ultimo_heartbeat: monitor.ultimo_heartbeat || session.heartbeatAt || null,
      connectionMode: monitor.connectionMode || session.connectionMode || null,
      reconnectCount: monitor.reconnectCount != null
        ? monitor.reconnectCount
        : (session.reconnectCount || 0),
      ultimo_erro: monitor.lastError || session.lastError || null,
      host: session.host || alvo.host || null,
      porta: session.porta != null ? session.porta : (alvo.porta || null),
      session,
      conexao: blocos.conexao || monitor,
      monitor,
      comunicacao_real: true,
      fonte: 'EquipmentSession'
    };
  }

  listarAtivas() {
    const lista = typeof connectionManager.listConnections === 'function'
      ? connectionManager.listConnections()
      : [];
    return (lista || []).map((c) => {
      const chave = c.host && c.porta ? `${c.host}:${c.porta}` : `eq:${c.equipamentoId}`;
      return {
        ...this.obterStatus(chave),
        host: c.host,
        porta: c.porta
      };
    });
  }

  async obterStatusTransporte(idOuChave) {
    return this.obterStatus(idOuChave);
  }

  reiniciar() {
    return { ok: true };
  }
}

const connectionMonitor = new ConnectionMonitor();

module.exports = connectionMonitor;
module.exports.ConnectionMonitor = ConnectionMonitor;
