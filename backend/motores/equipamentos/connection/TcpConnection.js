/**
 * Sprint 14.3 — TcpConnection
 * Abre/fecha sockets. Não interpreta bytes. Não conhece protocolo.
 * RC14.14.10 — Auditoria completa do pipeline TX/RX.
 */

'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const { audit, formatTx, formatRx, hexOf, asciiOf } = require('./TxRxPipelineAudit');
const socketCloseAudit = require('./SocketCloseAudit');
const { CLOSE_KIND } = socketCloseAudit;

const TIMEOUT_PADRAO_MS = 1000;

class TcpConnection extends EventEmitter {
  /**
   * @param {{host:string, porta:number, timeoutMs?:number}} opcoes
   */
  constructor(opcoes = {}) {
    super();
    this.host = String(opcoes.host || '');
    this.porta = Number(opcoes.porta) || 0;
    this.timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : TIMEOUT_PADRAO_MS;
    this.socket = null;
    this._aberto = false;
    this._latenciaConnect = null;
    /** Fila RX — evita perda se a resposta chegar antes de read()/receive(). */
    this._rxQueue = [];
    /** RC14.14.10 — correlação TX → RX */
    this._lastTxAt = null;
    this._lastTxHex = null;
    this._lastTxAscii = null;
    this._lastTxBytes = 0;
  }

  get aberto() {
    return this._aberto && this.socket && !this.socket.destroyed;
  }

  _metaSocket() {
    return { host: this.host, porta: this.porta };
  }

  /**
   * Instrumenta eventos do socket (timeout/close/end/error/drain).
   * connect/data são tratados nos handlers principais (com latência / RX HEX).
   */
  _instrumentarEventosSocket(socket) {
    const meta = this._metaSocket();
    // RC15.9 — intercepta end/destroy/destroySoon + classifica close
    socketCloseAudit.instrumentSocket(socket, {
      ...meta,
      origem: 'TcpConnection'
    });

    const logEvento = (nome, extra = {}) => {
      audit(`SOCKET ${nome}`, {
        ...meta,
        ...extra
      });
    };

    socket.on('timeout', () => {
      socketCloseAudit.markTimeout(socket);
      logEvento('timeout');
    });
    socket.on('close', (hadError) => {
      const classification = socketCloseAudit.classifyAndLogClose(socket, Boolean(hadError), meta);
      logEvento('close', {
        hadError: Boolean(hadError),
        closeKind: classification?.kind || null,
        iniciador: classification?.iniciador || null
      });
    });
    socket.on('end', () => {
      const remote = socketCloseAudit.markRemoteEnd(socket, meta);
      logEvento('end', {
        closeKind: remote?.kind || null,
        remoto: remote?.remoto === true
      });
    });
    socket.on('error', (err) => {
      socketCloseAudit.markError(socket, err);
      logEvento('error', {
        erro: err?.message || String(err),
        code: err?.code || null
      });
    });
    socket.on('drain', () => logEvento('drain'));
  }

  /**
   * Abre socket TCP (apenas handshake). Não envia comandos.
   * @returns {Promise<{latencia:number}>}
   */
  open() {
    if (this.aberto) {
      return Promise.resolve({ latencia: this._latenciaConnect });
    }
    if (!this.host || !this.porta) {
      return Promise.reject(Object.assign(new Error('host e porta obrigatórios'), {
        code: 'TCP_INPUT_INVALIDO',
        statusCode: 400
      }));
    }

    return new Promise((resolve, reject) => {
      const inicio = process.hrtime.bigint();
      const socket = new net.Socket();
      this.socket = socket;
      let finalizado = false;

      const falhar = (err, status = 'error') => {
        if (finalizado) return;
        finalizado = true;
        this._aberto = false;
        const kind = status === 'timeout'
          ? CLOSE_KIND.TIMEOUT_CLOSE
          : CLOSE_KIND.ERROR_CLOSE;
        try {
          socketCloseAudit.markLocalClose(socket, {
            origem: 'TcpConnection.open.falhar',
            metodo: 'socket.destroy()',
            kind,
            host: this.host,
            porta: this.porta
          });
          socket.destroy();
        } catch (_) { /* ignore */ }
        if (status !== 'error' || this.listenerCount('error') > 0) {
          this.emit(status, err instanceof Error ? err : new Error(String(err)));
        } else if (status === 'error' && this.listenerCount('fail') > 0) {
          this.emit('fail', err);
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      this._instrumentarEventosSocket(socket);
      socket.setTimeout(this.timeoutMs);

      const onOpenError = (err) => falhar(err);
      const onOpenTimeout = () => {
        const err = new Error('Timeout de conexão TCP');
        err.code = 'TCP_TIMEOUT';
        err.statusCode = 408;
        this.emit('timeout', err);
        falhar(err, 'timeout');
      };

      // Listeners de falha do open (além da instrumentação contínua)
      socket.once('timeout', onOpenTimeout);
      socket.once('error', onOpenError);

      socket.once('connect', () => {
        if (finalizado) return;
        finalizado = true;
        socket.removeListener('timeout', onOpenTimeout);
        socket.removeListener('error', onOpenError);
        this._latenciaConnect = Math.max(0, Math.round(Number(process.hrtime.bigint() - inicio) / 1e6));
        this._aberto = true;
        socket.setTimeout(0);

        socket.on('error', (err) => {
          this._aberto = false;
          this.emit('error', err);
        });
        socket.on('close', () => {
          this._aberto = false;
          this.emit('close');
        });
        socket.on('data', (buf) => {
          const chunk = Buffer.from(buf);
          this._rxQueue.push(chunk);
          const tempoDesdeTxMs = this._lastTxAt != null
            ? Math.max(0, Date.now() - this._lastTxAt)
            : null;
          const rx = formatRx(chunk, {
            host: this.host,
            porta: this.porta,
            tempoDesdeTxMs
          });
          audit('RX DATA', {
            ...rx,
            ultimoTxHex: this._lastTxHex,
            ultimoTxBytes: this._lastTxBytes
          });
          this.emit('data', chunk);
        });

        audit('SOCKET connect', {
          host: this.host,
          porta: this.porta,
          latenciaMs: this._latenciaConnect
        });
        this.emit('connect', { latencia: this._latenciaConnect });
        resolve({ latencia: this._latenciaConnect });
      });

      this.emit('creating');
      try {
        socket.connect(this.porta, this.host);
      } catch (err) {
        falhar(err);
      }
    });
  }

  /**
   * Escreve bytes crus — RC14.14.10 instrumenta TX antes/depois do write.
   */
  write(data) {
    if (!this.aberto) {
      throw Object.assign(new Error('Socket não conectado'), { code: 'TCP_NOT_CONNECTED' });
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const tx = formatTx(buf, { host: this.host, porta: this.porta });

    audit('TX BEFORE WRITE', tx);

    this._lastTxAt = Date.now();
    this._lastTxHex = tx.txHex;
    this._lastTxAscii = tx.txAscii;
    this._lastTxBytes = tx.bytes;

    const ok = this.socket.write(buf, (err) => {
      if (err) {
        audit('TX WRITE CALLBACK ERROR', {
          host: this.host,
          porta: this.porta,
          erro: err.message,
          bytes: buf.length,
          txHex: tx.txHex
        });
      } else {
        audit('TX WRITE CALLBACK OK', {
          host: this.host,
          porta: this.porta,
          bytesEnviados: buf.length,
          txHex: tx.txHex
        });
      }
    });

    audit('TX AFTER WRITE', {
      host: this.host,
      porta: this.porta,
      bytesSolicitados: buf.length,
      bytesEfetivos: buf.length,
      writeRetorno: ok === true ? 'true (buffered/flushed)' : 'false (wait drain)',
      txHex: tx.txHex,
      txAscii: tx.txAscii
    });

    this.emit('write', buf.length);
    return buf.length;
  }

  /**
   * Lê próximo pacote (Promise única) ou null se timeoutMs esgotar.
   * Sem interpretação.
   */
  read({ timeoutMs = 500 } = {}) {
    if (!this.aberto) {
      return Promise.reject(Object.assign(new Error('Socket não conectado'), { code: 'TCP_NOT_CONNECTED' }));
    }
    if (this._rxQueue.length) {
      const buf = this._rxQueue.shift();
      const tempoDesdeTxMs = this._lastTxAt != null
        ? Math.max(0, Date.now() - this._lastTxAt)
        : null;
      audit('RX FROM QUEUE', formatRx(buf, {
        host: this.host,
        porta: this.porta,
        tempoDesdeTxMs
      }));
      return Promise.resolve(buf);
    }
    return new Promise((resolve) => {
      let finalizado = false;
      const inicioWait = Date.now();
      const waitMs = Math.max(0, Number(timeoutMs) || 0);
      const concluir = (valor) => {
        if (finalizado) return;
        finalizado = true;
        limpar();
        resolve(valor);
      };
      const onData = () => {
        concluir(this._rxQueue.length ? this._rxQueue.shift() : null);
      };
      const onClose = () => {
        audit('RX ABORTED CLOSE', {
          host: this.host,
          porta: this.porta,
          tempoAguardadoMs: Date.now() - inicioWait,
          ultimoTxHex: this._lastTxHex
        });
        concluir(null);
      };
      const timer = setTimeout(() => {
        audit('Timeout aguardando RX', {
          host: this.host,
          porta: this.porta,
          tempoAguardadoMs: Date.now() - inicioWait,
          timeoutMs: waitMs,
          ultimoComandoHex: this._lastTxHex,
          ultimoComandoAscii: this._lastTxAscii,
          ultimoComandoBytes: this._lastTxBytes
        });
        concluir(null);
      }, waitMs);
      const limpar = () => {
        clearTimeout(timer);
        this.removeListener('data', onData);
        this.removeListener('close', onClose);
        this.removeListener('destroy', onClose);
      };
      this.once('data', onData);
      this.once('close', onClose);
      this.once('destroy', onClose);
      if (this._rxQueue.length) {
        concluir(this._rxQueue.shift());
      }
    });
  }

  close() {
    this._rxQueue = [];
    if (!this.socket) {
      this._aberto = false;
      return Promise.resolve();
    }
    if (this.socket.destroyed) {
      this._aberto = false;
      this.socket = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const sock = this.socket;
      // RC15.9 — intenção local antes de end/destroy
      socketCloseAudit.markLocalClose(sock, {
        origem: 'TcpConnection',
        metodo: 'close()',
        kind: CLOSE_KIND.LOCAL_CLOSE,
        host: this.host,
        porta: this.porta
      });
      let doneOnce = false;
      const done = () => {
        if (doneOnce) return;
        doneOnce = true;
        this._aberto = false;
        resolve();
      };
      try {
        sock.removeAllListeners('timeout');
        sock.once('close', done);
        sock.end();
        setTimeout(() => {
          try { sock.destroy(); } catch (_) { /* ignore */ }
          done();
        }, 150).unref?.();
      } catch (_) {
        try { sock.destroy(); } catch (__) { /* ignore */ }
        done();
      }
    });
  }

  destroy() {
    this._aberto = false;
    this._rxQueue = [];
    if (!this.socket) return;
    const sock = this.socket;
    try {
      socketCloseAudit.markLocalClose(sock, {
        origem: 'TcpConnection',
        metodo: 'destroy()',
        kind: CLOSE_KIND.LOCAL_CLOSE,
        host: this.host,
        porta: this.porta
      });
      // Classifica antes de removeAllListeners (senão perde o handler close)
      socketCloseAudit.classifyAndLogClose(sock, false, this._metaSocket());
      sock.removeAllListeners();
      sock.destroy();
    } catch (_) { /* ignore */ }
    this.socket = null;
    this.emit('destroy');
  }
}

module.exports = TcpConnection;
module.exports.TcpConnection = TcpConnection;
module.exports.TIMEOUT_PADRAO_MS = TIMEOUT_PADRAO_MS;
// reexport helpers usados em testes
module.exports.hexOf = hexOf;
module.exports.asciiOf = asciiOf;
