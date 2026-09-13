/**
 * Sprint 15.0 — TcpScanner
 * Percorre hosts da sub-rede e testa portas TCP em paralelo.
 * Timeout padrão: 200 ms | Concorrência padrão: 50
 */

'use strict';

const net = require('net');

const DEFAULTS = Object.freeze({
  timeoutMs: 200,
  concorrencia: 50,
  portas: [9000]
});

class TcpScanner {
  /**
   * @param {{timeoutMs?:number, concorrencia?:number, portas?:number[]}} [opcoes]
   */
  constructor(opcoes = {}) {
    this.timeoutMs = Math.max(50, Math.min(10000, Number(opcoes.timeoutMs) || DEFAULTS.timeoutMs));
    this.concorrencia = Math.max(1, Math.min(128, Number(opcoes.concorrencia) || DEFAULTS.concorrencia));
    this.portas = (Array.isArray(opcoes.portas) && opcoes.portas.length
      ? opcoes.portas
      : DEFAULTS.portas
    ).map(Number).filter((p) => p > 0 && p <= 65535);

    this._stats = this._statsVazias();
  }

  _statsVazias() {
    return {
      hostsAnalisados: 0,
      hostsConectados: 0,
      portasAbertas: 0,
      timeouts: 0,
      erros: 0,
      tempoTotalMs: 0,
      tempoMedioMs: null,
      probes: 0
    };
  }

  obterEstatisticas() {
    return { ...this._stats };
  }

  /**
   * Probe TCP único. Fecha o socket imediatamente após connect.
   * @returns {Promise<{aberta:boolean, latencia:number|null, timeout:boolean}>}
   */
  probe(host, porta, timeoutMs = this.timeoutMs) {
    const limite = Math.max(50, Number(timeoutMs) || this.timeoutMs);
    return new Promise((resolve) => {
      const inicio = process.hrtime.bigint();
      const socket = new net.Socket();
      let finalizado = false;

      const concluir = (aberta, timeout = false) => {
        if (finalizado) return;
        finalizado = true;
        const latencia = Number(process.hrtime.bigint() - inicio) / 1e6;
        try { socket.destroy(); } catch (_) { /* ignore */ }
        resolve({
          aberta: Boolean(aberta),
          latencia: aberta ? Math.max(0, Math.round(latencia)) : null,
          timeout: Boolean(timeout)
        });
      };

      socket.setTimeout(limite);
      socket.once('connect', () => concluir(true, false));
      socket.once('timeout', () => concluir(false, true));
      socket.once('error', () => concluir(false, false));
      try {
        socket.connect(Number(porta), String(host));
      } catch (_) {
        concluir(false, false);
      }
    });
  }

  /**
   * Escaneia hosts × portas com pool de concorrência.
   * @param {string[]} hosts
   * @param {{portas?:number[], concorrencia?:number, timeoutMs?:number, onProgress?:Function, shouldCancel?:Function}} [opts]
   * @returns {Promise<Array<{host:string, porta:number, aberta:boolean, latencia:number|null}>>}
   */
  async escanear(hosts, opts = {}) {
    const listaHosts = Array.isArray(hosts) ? hosts.map(String).filter(Boolean) : [];
    const portas = (Array.isArray(opts.portas) && opts.portas.length
      ? opts.portas
      : this.portas
    ).map(Number).filter((p) => p > 0 && p <= 65535);
    const concorrencia = Math.max(1, Math.min(128, Number(opts.concorrencia) || this.concorrencia));
    const timeoutMs = opts.timeoutMs != null ? Number(opts.timeoutMs) : this.timeoutMs;

    const alvos = [];
    for (const host of listaHosts) {
      for (const porta of portas) {
        alvos.push({ host, porta });
      }
    }

    this._stats = this._statsVazias();
    const inicio = Date.now();
    const abertos = [];
    const hostsComPorta = new Set();
    let indice = 0;
    let processados = 0;
    let somaLatencia = 0;
    let latenciasOk = 0;

    const worker = async () => {
      while (indice < alvos.length) {
        if (opts.shouldCancel && opts.shouldCancel()) return;
        const i = indice;
        indice += 1;
        const alvo = alvos[i];
        const r = await this.probe(alvo.host, alvo.porta, timeoutMs);
        this._stats.probes += 1;
        if (r.timeout) this._stats.timeouts += 1;
        if (r.aberta) {
          this._stats.portasAbertas += 1;
          hostsComPorta.add(alvo.host);
          if (r.latencia != null) {
            somaLatencia += r.latencia;
            latenciasOk += 1;
          }
          abertos.push({
            host: alvo.host,
            porta: alvo.porta,
            aberta: true,
            latencia: r.latencia
          });
        }
        processados += 1;
        if (typeof opts.onProgress === 'function') {
          opts.onProgress({
            processados,
            total: alvos.length,
            percentual: Math.round((processados / Math.max(1, alvos.length)) * 100),
            host: alvo.host,
            porta: alvo.porta,
            aberta: r.aberta
          });
        }
      }
    };

    const poolSize = Math.min(concorrencia, alvos.length || 1);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    this._stats.hostsAnalisados = listaHosts.length;
    this._stats.hostsConectados = hostsComPorta.size;
    this._stats.tempoTotalMs = Date.now() - inicio;
    this._stats.tempoMedioMs = latenciasOk > 0
      ? Math.round(somaLatencia / latenciasOk)
      : null;

    return abertos;
  }
}

module.exports = TcpScanner;
module.exports.TcpScanner = TcpScanner;
module.exports.DEFAULTS = DEFAULTS;
