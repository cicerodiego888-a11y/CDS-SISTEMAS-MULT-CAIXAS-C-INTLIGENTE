/**
 * RC15.0.1 — ConnectionTrace
 * Log estruturado do ciclo Connect → Handshake → RX/ACK.
 */

'use strict';

function agora() {
  return new Date().toISOString();
}

class ConnectionTrace {
  /**
   * @param {{host?:string, porta?:number, timeoutMs?:number}} meta
   */
  constructor(meta = {}) {
    this.host = meta.host || null;
    this.porta = meta.porta != null ? Number(meta.porta) : null;
    this.timeoutMs = meta.timeoutMs != null ? Number(meta.timeoutMs) : null;
    this.iniciadoEm = agora();
    this.passos = [];
    this.tcp = null;
    this.handshake = null;
    this.resultadoFinal = null;
    this.connectionMode = meta.connectionMode || null;
  }

  _passo(nome, dados = {}) {
    const entry = { passo: nome, em: agora(), ...dados };
    this.passos.push(entry);
    return entry;
  }

  inicioConnect() {
    this._passo('Connect()', {
      host: this.host,
      porta: this.porta,
      timeoutMs: this.timeoutMs
    });
    return this;
  }

  socketOk({ latenciaMs = null, reutilizada = false } = {}) {
    this.tcp = {
      ok: true,
      codigo: 'TCP_CONNECT_OK',
      latenciaMs,
      reutilizada: Boolean(reutilizada)
    };
    this._passo('Socket OK', { latenciaMs, reutilizada: Boolean(reutilizada) });
    return this;
  }

  socketFalha({ codigo, erro, latenciaMs = null } = {}) {
    this.tcp = {
      ok: false,
      codigo: codigo || 'TCP_CONNECT_SOCKET_EXCEPTION',
      erro: erro || null,
      latenciaMs
    };
    this._passo('Socket FALHA', { codigo: this.tcp.codigo, erro, latenciaMs });
    return this;
  }

  inicioHandshake() {
    this._passo('Handshake()', {});
    return this;
  }

  frameTx({ bytes = null, hexPreview = null, comando = null } = {}) {
    this._passo('Frame TX', { bytes, comando, hexPreview });
    return this;
  }

  frameRx({ bytes = null, hexPreview = null, comando = null } = {}) {
    this._passo('Frame RX', { bytes, comando, hexPreview });
    return this;
  }

  ack({ ok = true, latenciaMs = null, detalhe = null } = {}) {
    this.handshake = {
      ok: Boolean(ok),
      latenciaMs,
      detalhe
    };
    this._passo(ok ? 'ACK' : 'ACK FALHA', { latenciaMs, detalhe });
    return this;
  }

  finalizar(resultado) {
    this.resultadoFinal = resultado;
    this._passo('Resultado Final', { resultado });
    return this;
  }

  /**
   * Texto oficial para logs / painel.
   */
  toText() {
    const linhas = [
      '=== CONNECTION TRACE ===',
      '',
      `IP........: ${this.host || '—'}`,
      `PORTA.....: ${this.porta != null ? this.porta : '—'}`,
      `TIMEOUT...: ${this.timeoutMs != null ? `${this.timeoutMs} ms` : '—'}`,
      `MODE......: ${this.connectionMode || '—'}`,
      `INÍCIO....: ${this.iniciadoEm}`,
      ''
    ];
    for (const p of this.passos) {
      linhas.push(`[${p.passo}]`);
      Object.keys(p).forEach((k) => {
        if (k === 'passo' || k === 'em') return;
        const v = p[k];
        if (v == null) return;
        linhas.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      });
      linhas.push('');
    }
    if (this.tcp) {
      linhas.push('--- TCP ---');
      linhas.push(`  ok: ${this.tcp.ok}`);
      linhas.push(`  codigo: ${this.tcp.codigo}`);
      if (this.tcp.latenciaMs != null) linhas.push(`  latenciaMs: ${this.tcp.latenciaMs}`);
      if (this.tcp.erro) linhas.push(`  erro: ${this.tcp.erro}`);
      linhas.push('');
    }
    if (this.handshake) {
      linhas.push('--- HANDSHAKE ---');
      linhas.push(`  ok: ${this.handshake.ok}`);
      if (this.handshake.latenciaMs != null) linhas.push(`  latenciaMs: ${this.handshake.latenciaMs}`);
      if (this.handshake.detalhe) linhas.push(`  detalhe: ${this.handshake.detalhe}`);
      linhas.push('');
    }
    if (this.resultadoFinal) {
      linhas.push(`RESULTADO FINAL: ${this.resultadoFinal}`);
    }
    return linhas.join('\n');
  }

  toJSON() {
    return {
      host: this.host,
      porta: this.porta,
      timeoutMs: this.timeoutMs,
      connectionMode: this.connectionMode,
      iniciadoEm: this.iniciadoEm,
      passos: this.passos,
      tcp: this.tcp,
      handshake: this.handshake,
      resultadoFinal: this.resultadoFinal,
      texto: this.toText()
    };
  }
}

function criar(meta) {
  return new ConnectionTrace(meta);
}

/**
 * Emite log estruturado (LoggerService se disponível).
 */
async function emitir(trace, nivel = 'info') {
  const texto = typeof trace.toText === 'function' ? trace.toText() : String(trace);
  try {
    const logger = require('../services/LoggerService');
    const fn = logger[nivel] || logger.info;
    await fn.call(logger, 'CONNECTION TRACE', {
      operacao: 'connection_trace',
      contexto: typeof trace.toJSON === 'function' ? trace.toJSON() : { texto }
    });
  } catch (_) {
    // eslint-disable-next-line no-console
    console.log(texto);
  }
  return texto;
}

module.exports = {
  ConnectionTrace,
  criar,
  emitir
};
