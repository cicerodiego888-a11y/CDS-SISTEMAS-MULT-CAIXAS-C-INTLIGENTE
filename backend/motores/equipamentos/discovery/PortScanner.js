/**
 * Sprint 14.1 — PortScanner
 * Testa portas TCP em hosts. V1: apenas 9000 (Toledo Prix IV Uno).
 * Estrutura pronta para 9050, 9100, 10001.
 */

'use strict';

const net = require('net');

/** Portas oficiais do Discovery Engine (ordem de prioridade). */
const PORTAS_CONHECIDAS = Object.freeze([9000, 9050, 9100, 10001]);

/** V1 — somente a porta descoberta na implantação Toledo. */
const PORTAS_V1 = Object.freeze([9000]);

class PortScanner {
  constructor({ timeoutMs = 400, portas = PORTAS_V1 } = {}) {
    this.timeoutMs = Math.max(50, Math.min(10000, Number(timeoutMs) || 400));
    this.portas = (Array.isArray(portas) && portas.length
      ? portas
      : PORTAS_V1
    ).map(Number).filter((p) => p > 0 && p <= 65535);
  }

  /**
   * Probe TCP único. Resolve { aberta, latencia } sem deixar socket aberto.
   * @param {string} host
   * @param {number} porta
   * @returns {Promise<{aberta:boolean, latencia:number|null}>}
   */
  probe(host, porta) {
    const timeoutMs = this.timeoutMs;
    return new Promise((resolve) => {
      const inicio = process.hrtime.bigint();
      const socket = new net.Socket();
      let finalizado = false;

      const concluir = (aberta) => {
        if (finalizado) return;
        finalizado = true;
        const latencia = Number(process.hrtime.bigint() - inicio) / 1e6;
        try { socket.destroy(); } catch (_) { /* ignore */ }
        resolve({
          aberta: Boolean(aberta),
          latencia: aberta ? Math.max(0, Math.round(latencia)) : null
        });
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => concluir(true));
      socket.once('timeout', () => concluir(false));
      socket.once('error', () => concluir(false));
      try {
        socket.connect(Number(porta), String(host));
      } catch (_) {
        concluir(false);
      }
    });
  }

  /**
   * Escaneia um host nas portas configuradas.
   * @returns {Promise<Array<{host, porta, aberta, latencia}>>}
   */
  async escanearHost(host) {
    const resultados = [];
    for (const porta of this.portas) {
      const r = await this.probe(host, porta);
      resultados.push({ host: String(host), porta, aberta: r.aberta, latencia: r.latencia });
    }
    return resultados;
  }

  /**
   * Escaneia vários hosts com concorrência limitada.
   * @param {string[]} hosts
   * @param {{concorrencia?:number, onProgress?:Function, shouldCancel?:Function}} [opts]
   * @returns {Promise<Array<{host, porta, aberta, latencia}>>}
   */
  async escanearHosts(hosts, opts = {}) {
    const lista = Array.isArray(hosts) ? hosts : [];
    const concorrencia = Math.max(1, Math.min(64, Number(opts.concorrencia) || 32));
    const abertos = [];
    let indice = 0;
    let processados = 0;

    const worker = async () => {
      while (indice < lista.length) {
        if (opts.shouldCancel && opts.shouldCancel()) return;
        const i = indice;
        indice += 1;
        const host = lista[i];
        const resultados = await this.escanearHost(host);
        for (const r of resultados) {
          if (r.aberta) abertos.push(r);
        }
        processados += 1;
        if (typeof opts.onProgress === 'function') {
          opts.onProgress({
            processados,
            total: lista.length,
            percentual: Math.round((processados / Math.max(1, lista.length)) * 100),
            host
          });
        }
      }
    };

    const pool = [];
    for (let w = 0; w < Math.min(concorrencia, lista.length || 1); w += 1) {
      pool.push(worker());
    }
    await Promise.all(pool);
    return abertos;
  }
}

module.exports = PortScanner;
module.exports.PortScanner = PortScanner;
module.exports.PORTAS_V1 = PORTAS_V1;
module.exports.PORTAS_CONHECIDAS = PORTAS_CONHECIDAS;
