/**
 * EthernetTransport (legado) — RC14.14.1
 *
 * Em produção NÃO abre socket próprio.
 * Delega para o ConnectionManager oficial (connection/).
 *
 * Lab/compat: CDS_LEGACY_TRANSPORT_SOCKET=1 reativa net.createConnection.
 */

'use strict';

const net = require('net');
const BaseTransport = require('./BaseTransport');
const loggerService = require('../services/LoggerService');

const { PORTA_PADRAO } = require('../drivers/toledo/ToledoProtocol');
const ToledoTimeouts = require('../drivers/toledo/ToledoTimeouts');

const TIMEOUT_PADRAO = ToledoTimeouts.CONNECT;
const MAX_RECONEXOES_PADRAO = Number(process.env.EQUIPAMENTOS_ETHERNET_MAX_RECONNECT || 3);
const INTERVALO_RECONEXAO_PADRAO = Number(process.env.EQUIPAMENTOS_ETHERNET_RECONNECT_MS || 2000);
const ALLOW_LEGACY_SOCKET = process.env.CDS_LEGACY_TRANSPORT_SOCKET === '1';

class EthernetTransport extends BaseTransport {
  constructor(config = {}) {
    super(config);
    this._host = config.host || config.ip || '127.0.0.1';
    this._porta = Number(config.porta || config.port || PORTA_PADRAO);
    this._timeout = config.timeout ?? TIMEOUT_PADRAO;
    this._maxReconexoes = config.tentativas ?? config.maxReconexoes ?? MAX_RECONEXOES_PADRAO;
    this._intervaloReconexao = config.intervaloReconexao ?? INTERVALO_RECONEXAO_PADRAO;
    this._tentativasReconexao = 0;
    /** @type {import('net').Socket|null} */
    this._socket = null;
    /** @type {boolean} */
    this._delegado = false;
    /** @type {Buffer[]} */
    this._bufferRecebimento = [];
    /** @type {Array<{resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this._aguardandoLeitura = [];
    this._conectadoEm = null;
    this._ultimoErro = null;
    this._reconectando = false;
  }

  tipo() {
    return 'ethernet';
  }

  connect() { return this.conectar(); }
  disconnect() { return this.desconectar(); }
  isConnected() {
    if (this._delegado) {
      try {
        const cm = require('../connection/ConnectionManager');
        return cm.isConnected({ host: this._host, porta: this._porta });
      } catch (_) {
        return false;
      }
    }
    return this.estaConectado() && !!this._socket && !this._socket.destroyed;
  }
  write(dados) { return this.enviar(dados); }
  read(opcoes) { return this.receber(opcoes); }
  reconnect() { return this.reconectar(); }
  timeout(ms) {
    if (ms != null) this._timeout = Number(ms);
    return this._timeout;
  }

  async _logConexao(mensagem, status, detalhe = {}) {
    await loggerService.logTransporte({
      transporte: 'ethernet',
      operacao: detalhe.operacao || 'conexao',
      equipamento_id: this.config.equipamento_id ?? null,
      host: this._host,
      porta: this._porta,
      status,
      mensagem,
      detalhe: { ...detalhe, mensagem }
    });
  }

  /**
   * RC14.14.1 — delega ao CM oficial (sem abrir socket legado).
   */
  async conectar() {
    if (!ALLOW_LEGACY_SOCKET) {
      const cm = require('../connection/ConnectionManager');
      await cm.connect({
        host: this._host,
        porta: this._porta,
        timeoutMs: this._timeout || ToledoTimeouts.CONNECT,
        persistir: this.config.persistir !== false
      });
      this._delegado = true;
      this._conectadoEm = new Date().toISOString();
      this._marcadoConectado();
      await this._logConexao('Conexão delegada ao ConnectionManager oficial', 'ok', {
        operacao: 'conectar_delegado'
      });
      return cm.getTcp({ host: this._host, porta: this._porta });
    }

    return this._conectarLegadoSocket();
  }

  _abrirSocket() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this._host,
        port: this._porta
      });
      const timer = setTimeout(() => {
        socket.destroy();
        const err = new Error(`Timeout TCP ${this._timeout}ms`);
        err.code = 'TCP_TIMEOUT';
        reject(err);
      }, this._timeout);

      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async _conectarLegadoSocket() {
    if (this.isConnected()) return this._socket;
    this._socket = await this._abrirSocket();
    this._conectadoEm = new Date().toISOString();
    this._marcadoConectado();
    this._socket.on('data', (buf) => {
      if (this._aguardandoLeitura.length) {
        const wait = this._aguardandoLeitura.shift();
        clearTimeout(wait.timer);
        wait.resolve(buf);
      } else {
        this._bufferRecebimento.push(buf);
      }
    });
    this._socket.on('close', () => {
      this._marcadoDesconectado();
      this._socket = null;
    });
    this._socket.on('error', (err) => {
      this._ultimoErro = err.message;
    });
    await this._logConexao('Socket legado aberto (CDS_LEGACY_TRANSPORT_SOCKET=1)', 'ok', {
      operacao: 'conectar_legado'
    });
    return this._socket;
  }

  async desconectar() {
    if (this._delegado) {
      try {
        const cm = require('../connection/ConnectionManager');
        const { podeHeartbeatDisconnect } = require('../connection/SessionBusy');
        const session = typeof cm.getSession === 'function'
          ? cm.getSession({ host: this._host, porta: this._porta })
          : null;
        // RC15.10 — Heartbeat/legado NÃO derruba sessão busy ou persistente
        if (!podeHeartbeatDisconnect(session)) {
          await this._logConexao(
            'desconectar ignorado — sessão busy/persistente (RC15.10)',
            'ok',
            { operacao: 'desconectar_bloqueado_rc1510', busy: session?.busy, persistent: session?.persistent }
          );
          this._delegado = false;
          this._marcadoDesconectado();
          return;
        }
        await cm.disconnect({ host: this._host, porta: this._porta });
      } catch (_) { /* ignore */ }
      this._delegado = false;
      this._marcadoDesconectado();
      return;
    }
    if (this._socket) {
      try { this._socket.destroy(); } catch (_) { /* ignore */ }
      this._socket = null;
    }
    this._marcadoDesconectado();
  }

  estaConectado() {
    return this.isConnected();
  }

  async enviar(dados) {
    const buf = Buffer.isBuffer(dados) ? dados : Buffer.from(dados);
    if (this._delegado) {
      const cm = require('../connection/ConnectionManager');
      return cm.send({ host: this._host, porta: this._porta }, buf);
    }
    if (!this._socket || this._socket.destroyed) {
      const err = new Error('EthernetTransport: não conectado');
      err.code = 'NOT_CONNECTED';
      throw err;
    }
    this._socket.write(buf);
    return buf.length;
  }

  receber(opcoes = {}) {
    const timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : ToledoTimeouts.READ;
    if (this._delegado) {
      const cm = require('../connection/ConnectionManager');
      return cm.receive({ host: this._host, porta: this._porta }, { timeoutMs });
    }
    return new Promise((resolve, reject) => {
      if (this._bufferRecebimento.length) {
        resolve(this._bufferRecebimento.shift());
        return;
      }
      const timer = setTimeout(() => {
        const idx = this._aguardandoLeitura.findIndex((w) => w.timer === timer);
        if (idx >= 0) this._aguardandoLeitura.splice(idx, 1);
        const err = new Error('Timeout leitura');
        err.code = 'READ_TIMEOUT';
        reject(err);
      }, timeoutMs);
      this._aguardandoLeitura.push({ resolve, reject, timer });
    });
  }

  async reconectar() {
    await this.desconectar();
    return this.conectar();
  }

  async ping() {
    if (this._delegado) {
      const cm = require('../connection/ConnectionManager');
      return cm.isConnected({ host: this._host, porta: this._porta });
    }
    return this.isConnected();
  }

  async status() {
    return {
      conectado: this.isConnected(),
      host: this._host,
      porta: this._porta,
      delegado: this._delegado,
      legadoSocket: ALLOW_LEGACY_SOCKET && !this._delegado
    };
  }

  async reiniciar() {
    return this.reconectar();
  }

  async configurar(cfg = {}) {
    if (cfg.host || cfg.ip) this._host = cfg.host || cfg.ip;
    if (cfg.porta != null || cfg.port != null) {
      this._porta = Number(cfg.porta || cfg.port);
    }
    if (cfg.timeout != null) this._timeout = Number(cfg.timeout);
    return this.status();
  }

  _marcadoConectado() {
    this._conectado = true;
  }

  _marcadoDesconectado() {
    this._conectado = false;
  }

  get host() { return this._host; }
  get porta() { return this._porta; }
}

module.exports = EthernetTransport;
