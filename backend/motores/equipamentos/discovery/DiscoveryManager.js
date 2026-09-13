/**
 * Sprint 15.0 — DiscoveryManager
 * Orquestra USB + Serial + Ethernet em paralelo.
 * Não altera o comportamento interno de cada transporte.
 */

'use strict';

const ethernetDiscovery = require('./EthernetDiscovery');

class DiscoveryManager {
  constructor(deps = {}) {
    this.ethernetDiscovery = deps.ethernetDiscovery || ethernetDiscovery;
    this._emExecucao = false;
    this._cancelado = false;
  }

  cancelar() {
    this._cancelado = true;
    try { this.ethernetDiscovery.cancelar(); } catch (_) { /* ignore */ }
    try {
      const discoveryService = require('./DiscoveryService');
      discoveryService.cancelar();
    } catch (_) { /* ignore */ }
  }

  estaEmExecucao() {
    return this._emExecucao === true
      || this.ethernetDiscovery.estaEmExecucao?.() === true;
  }

  /**
   * @param {object} [opcoes]
   * @param {string[]} [opcoes.transportes] usb|serial|ethernet
   */
  async descobrir(opcoes = {}) {
    if (this._emExecucao) {
      const err = new Error('DiscoveryManager já em execução.');
      err.code = 'DISCOVERY_EM_EXECUCAO';
      err.statusCode = 409;
      throw err;
    }

    this._cancelado = false;
    this._emExecucao = true;
    const iniciado = Date.now();

    const transportesRaw = Array.isArray(opcoes.transportes) && opcoes.transportes.length
      ? opcoes.transportes.map((t) => String(t).toLowerCase())
      : ['usb', 'serial', 'ethernet'];
    const transportes = [...new Set(transportesRaw)];

    const tarefas = [];
    const labels = [];

    if (transportes.includes('ethernet')) {
      labels.push('ethernet');
      tarefas.push(this._safe(() => this.ethernetDiscovery.executar({
        ...opcoes,
        timeoutTcpMs: opcoes.timeoutTcpMs != null ? opcoes.timeoutTcpMs : opcoes.timeoutMs,
        onProgress: opcoes.onProgress
      }), 'ethernet'));
    }

    if (transportes.includes('usb') || transportes.includes('serial')) {
      try {
        const discoveryService = require('./DiscoveryService');
        if (transportes.includes('usb')) {
          labels.push('usb');
          tarefas.push(this._safe(() => discoveryService.descobrirUsb({
            ...opcoes,
            _interno: true,
            timeoutMs: opcoes.timeoutMsUsb || opcoes.timeoutMs || 500
          }), 'usb'));
        }
        if (transportes.includes('serial')) {
          labels.push('serial');
          tarefas.push(this._safe(() => discoveryService.descobrirSerial({
            ...opcoes,
            _interno: true,
            timeoutMs: opcoes.timeoutMsSerial || opcoes.timeoutMs || 500
          }), 'serial'));
        }
      } catch (err) {
        labels.push('legacy');
        tarefas.push(Promise.resolve({
          sucesso: false,
          candidatos: [],
          erros: [{ codigo: 'DISCOVERY_SERVICE_INDISPONIVEL', mensagem: err.message }],
          meta: { transporte: 'legacy' }
        }));
      }
    }

    try {
      const resultados = await Promise.all(tarefas);
      const candidatos = [];
      const erros = [];
      const porTransporte = {};

      resultados.forEach((r, idx) => {
        const label = labels[idx] || `t${idx}`;
        porTransporte[label] = {
          sucesso: r.sucesso !== false,
          quantidade: (r.candidatos || r.equipamentos || []).length,
          meta: r.meta || {},
          erros: r.erros || []
        };
        const lista = r.candidatos || r.equipamentos || [];
        for (const c of lista) {
          candidatos.push(this._normalizarCandidato(c, label));
        }
        if (Array.isArray(r.erros)) erros.push(...r.erros);
      });

      return {
        sucesso: true,
        candidatos,
        erros,
        meta: {
          engine: 'discovery-manager-15.0',
          transportes_executados: labels,
          por_transporte: porTransporte,
          encontrados: candidatos.length,
          duracaoMs: Date.now() - iniciado,
          cancelado: this._cancelado
        }
      };
    } finally {
      this._emExecucao = false;
    }
  }

  /**
   * Atalho Sprint 15 — apenas Ethernet.
   */
  async descobrirEthernet(opcoes = {}) {
    return this.ethernetDiscovery.executar(opcoes);
  }

  async _safe(fn, transporte) {
    try {
      const r = await fn();
      return r || { sucesso: true, candidatos: [], meta: { transporte } };
    } catch (err) {
      return {
        sucesso: false,
        candidatos: [],
        erros: [{ codigo: 'DISCOVERY_TRANSPORTE_FALHOU', mensagem: err.message, transporte }],
        meta: { transporte }
      };
    }
  }

  _normalizarCandidato(c, transporteHint) {
    if (!c || typeof c !== 'object') return c;
    // Já no formato Sprint 15 Ethernet
    if (c.endpoint && c.transporte === 'ethernet') return c;

    const transporte = c.transporte || transporteHint;
    if (transporte === 'ethernet' || c.ip || c.host) {
      const ip = c.ip || c.host || null;
      const porta = c.porta || c.porta_tcp || null;
      const conf = c.confiança != null
        ? Number(c.confiança)
        : (c.confianca != null
          ? (Number(c.confianca) <= 1 ? Math.round(Number(c.confianca) * 100) : Number(c.confianca))
          : null);
      return {
        transporte: 'ethernet',
        endpoint: ip && porta ? `${ip}:${porta}` : (c.endpoint || null),
        driver: c.driver || c.driver_codigo || null,
        fabricante: c.fabricante || null,
        modelo: c.modelo || null,
        confiança: conf,
        confianca: conf,
        ip,
        porta,
        identidade: c.identidade || { versao: c.firmware || null, ip },
        candidate_dto: c.candidate_dto || c
      };
    }

    return {
      transporte,
      endpoint: c.porta_com || c.caminho_dispositivo || c.endpoint || null,
      driver: c.driver || c.driver_codigo || null,
      fabricante: c.fabricante || null,
      modelo: c.modelo || null,
      confiança: c.confianca != null
        ? (Number(c.confianca) <= 1 ? Math.round(Number(c.confianca) * 100) : Number(c.confianca))
        : null,
      confianca: c.confianca != null
        ? (Number(c.confianca) <= 1 ? Math.round(Number(c.confianca) * 100) : Number(c.confianca))
        : null,
      porta_com: c.porta_com || null,
      vid: c.vid || null,
      pid: c.pid || null,
      candidate_dto: c
    };
  }
}

const discoveryManager = new DiscoveryManager();

/** RC14.12.3 — exportar instância + classe; nunca sobrescrever métodos da instância. */
module.exports = discoveryManager;
module.exports.DiscoveryManager = DiscoveryManager;
