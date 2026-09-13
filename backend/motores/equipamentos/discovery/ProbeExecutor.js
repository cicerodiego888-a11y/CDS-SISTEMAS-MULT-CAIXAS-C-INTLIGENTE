/**
 * Sprint 15.0 — ProbeExecutor
 * Conecta TCP → Driver.buildProbe() → send/receive → matches/parseIdentity.
 * Registra TX/RX no Laboratório mesmo em falha.
 */

'use strict';

const net = require('net');
const FrameCapture = require('../laboratorio/FrameCapture');

function toBuffer(dados) {
  if (!dados) return Buffer.alloc(0);
  if (Buffer.isBuffer(dados)) return Buffer.from(dados);
  if (dados instanceof Uint8Array) return Buffer.from(dados);
  if (typeof dados === 'string') return Buffer.from(dados, 'binary');
  if (dados.dados != null) return toBuffer(dados.dados);
  return Buffer.alloc(0);
}

function toHex(buf) {
  return Buffer.isBuffer(buf) ? buf.toString('hex') : '';
}

class ProbeExecutor {
  /**
   * @param {{labLogger?:object|null}} [deps]
   */
  constructor(deps = {}) {
    this.labLogger = deps.labLogger || null;
    this._logs = [];
  }

  obterLogs() {
    return this._logs.slice();
  }

  limparLogs() {
    this._logs = [];
  }

  /**
   * Executa probe inteligente em um endpoint aberto.
   * @param {{host:string, porta:number, latencia?:number|null}} endpoint
   * @param {{codigo:string, instancia:object, discovery:object}} driverCtx
   * @param {{timeoutMs?:number}} [opcoes]
   * @returns {Promise<object>}
   */
  async executar(endpoint, driverCtx, opcoes = {}) {
    const host = String(endpoint.host || '');
    const porta = Number(endpoint.porta) || 0;
    const timeoutMs = Math.max(
      100,
      Number(opcoes.timeoutMs || driverCtx.discovery?.timeout || 500)
    );
    const driver = driverCtx.instancia;
    const codigo = driverCtx.codigo;
    const inicio = Date.now();

    const registro = {
      driver: codigo,
      ip: host,
      porta,
      tx: null,
      rx: null,
      hex_tx: null,
      hex_rx: null,
      tempo_ms: 0,
      resultado: 'FALHA',
      identidade: null,
      confianca: 0,
      erro: null
    };

    let socket = null;
    try {
      const probeBuf = this._buildProbe(driver);
      registro.tx = FrameCapture.capturar('TX', probeBuf, { host, porta });
      registro.hex_tx = toHex(probeBuf);

      const { socket: sock, latenciaConnect } = await this._conectar(host, porta, timeoutMs);
      socket = sock;

      await this._enviar(socket, probeBuf);
      const rxBuf = await this._receber(socket, timeoutMs);
      registro.rx = FrameCapture.capturar('RX', rxBuf, { host, porta });
      registro.hex_rx = toHex(rxBuf);
      registro.tempo_ms = Date.now() - inicio;

      const match = this._matches(driver, rxBuf);
      if (!match) {
        registro.resultado = rxBuf.length ? 'SEM_MATCH' : 'TIMEOUT_RX';
        registro.erro = rxBuf.length
          ? 'Resposta não corresponde ao driver'
          : 'Sem resposta ao probe';
        await this._persistirLab(registro);
        this._logs.push(registro);
        return { sucesso: false, registro, endpoint, driver: codigo };
      }

      const identidade = this._parseIdentity(driver, rxBuf) || {};
      const confianca = Number(identidade.confianca != null ? identidade.confianca : 0.98);
      registro.resultado = 'OK';
      registro.identidade = identidade;
      registro.confianca = confianca;
      registro.latencia_connect = latenciaConnect != null
        ? latenciaConnect
        : endpoint.latencia;

      await this._persistirLab(registro);
      this._logs.push(registro);

      return {
        sucesso: true,
        registro,
        endpoint,
        driver: codigo,
        identidade,
        confianca,
        latencia: registro.latencia_connect,
        rx: rxBuf,
        tx: probeBuf
      };
    } catch (err) {
      registro.tempo_ms = Date.now() - inicio;
      registro.resultado = 'ERRO';
      registro.erro = err.message || String(err);
      await this._persistirLab(registro);
      this._logs.push(registro);
      return { sucesso: false, registro, endpoint, driver: codigo, erro: err.message };
    } finally {
      if (socket) {
        try { socket.destroy(); } catch (_) { /* ignore */ }
      }
    }
  }

  _buildProbe(driver) {
    if (driver && typeof driver.buildProbe === 'function') {
      return toBuffer(driver.buildProbe());
    }
    if (driver?.protocol && typeof driver.protocol.buildProbe === 'function') {
      return toBuffer(driver.protocol.buildProbe());
    }
    if (driver?.discovery && typeof driver.discovery.buildProbe === 'function') {
      return toBuffer(driver.discovery.buildProbe());
    }
    return Buffer.alloc(0);
  }

  _matches(driver, rxBuf) {
    if (driver && typeof driver.matches === 'function') {
      return Boolean(driver.matches(rxBuf));
    }
    if (driver?.discovery && typeof driver.discovery.matches === 'function') {
      return Boolean(driver.discovery.matches(rxBuf));
    }
    // Sem matcher: qualquer RX com bytes conta como possível match fraco
    return Buffer.isBuffer(rxBuf) && rxBuf.length > 0;
  }

  _parseIdentity(driver, rxBuf) {
    if (driver && typeof driver.parseIdentity === 'function') {
      return driver.parseIdentity(rxBuf) || {};
    }
    if (driver?.discovery && typeof driver.discovery.parseIdentity === 'function') {
      return driver.discovery.parseIdentity(rxBuf) || {};
    }
    return {};
  }

  _conectar(host, porta, timeoutMs) {
    return new Promise((resolve, reject) => {
      const inicio = process.hrtime.bigint();
      const socket = new net.Socket();
      let done = false;
      const finish = (err, latencia) => {
        if (done) return;
        done = true;
        if (err) {
          try { socket.destroy(); } catch (_) { /* ignore */ }
          reject(err);
        } else {
          resolve({ socket, latencia });
        }
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => {
        const latencia = Math.max(0, Math.round(Number(process.hrtime.bigint() - inicio) / 1e6));
        finish(null, latencia);
      });
      socket.once('timeout', () => finish(new Error('Timeout ao conectar')));
      socket.once('error', (e) => finish(e));
      try {
        socket.connect(Number(porta), String(host));
      } catch (e) {
        finish(e);
      }
    });
  }

  _enviar(socket, buf) {
    return new Promise((resolve, reject) => {
      try {
        socket.write(buf, (err) => (err ? reject(err) : resolve()));
      } catch (e) {
        reject(e);
      }
    });
  }

  _receber(socket, timeoutMs) {
    return new Promise((resolve) => {
      const chunks = [];
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        resolve(Buffer.concat(chunks));
      }, timeoutMs);

      const onData = (data) => {
        chunks.push(Buffer.from(data));
        // Resposta curta de balança: fecha na primeira rajada
        if (!done && Buffer.concat(chunks).length > 0) {
          clearTimeout(timer);
          // pequena janela para bytes restantes
          setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            resolve(Buffer.concat(chunks));
          }, 40);
        }
      };
      const onErr = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(Buffer.concat(chunks));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onErr);
        socket.removeListener('close', onErr);
      };
      socket.on('data', onData);
      socket.once('error', onErr);
      socket.once('close', onErr);
    });
  }

  async _persistirLab(registro) {
    if (!this.labLogger || typeof this.labLogger.registrarProbe !== 'function') return;
    try {
      await this.labLogger.registrarProbe(registro);
    } catch (_) { /* lab nunca interrompe discovery */ }
  }
}

module.exports = ProbeExecutor;
module.exports.ProbeExecutor = ProbeExecutor;
