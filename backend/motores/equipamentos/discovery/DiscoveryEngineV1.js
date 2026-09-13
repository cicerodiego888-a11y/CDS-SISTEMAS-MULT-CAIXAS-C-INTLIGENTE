/**
 * Sprint 14.1 — Discovery Engine V1.0 (orquestrador de rede TCP).
 * Não comunica com balança, não identifica fabricante, não cadastra automaticamente.
 *
 * Fluxo: interfaces → faixa IP → scan hosts → portas → candidatos → persistir → lista
 *
 * O DiscoveryService legado (drivers) permanece em DiscoveryService.js para fluxos avançados.
 */

'use strict';

const NetworkScanner = require('./NetworkScanner');
const PortScanner = require('./PortScanner');
const DeviceCandidate = require('./DeviceCandidate');
const DiscoveryRepository = require('./DiscoveryRepository');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[discovery-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[discovery-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class DiscoveryEngineV1 {
  constructor() {
    this._cancelado = false;
    this._emExecucao = false;
    this.networkScanner = new NetworkScanner();
    this.repository = new DiscoveryRepository();
  }

  cancelar() {
    this._cancelado = true;
  }

  estaEmExecucao() {
    return this._emExecucao === true;
  }

  /**
   * Executa descoberta TCP V1.0.
   * @param {object} [opcoes]
   * @returns {Promise<object>} { equipamentos, meta }
   */
  async executar(opcoes = {}) {
    if (this._emExecucao) {
      const err = new Error('Discovery já em execução.');
      err.code = 'DISCOVERY_EM_EXECUCAO';
      err.statusCode = 409;
      throw err;
    }

    this._cancelado = false;
    this._emExecucao = true;
    const log = getLogger();
    const iniciado = Date.now();
    const progresso = [];

    const reportar = (evento, dados = {}) => {
      progresso.push({ evento, em: new Date().toISOString(), ...dados });
      if (typeof opcoes.onProgress === 'function') {
        try { opcoes.onProgress({ evento, ...dados }); } catch (_) { /* ignore */ }
      }
    };

    try {
      await log.info('Discovery iniciado', { operacao: 'discovery_v1' });
      reportar('Discovery iniciado');

      const rede = this.networkScanner.descobrirRede({
        maxHosts: Number(opcoes.maxHosts) || 254
      });

      await log.info('Interface encontrada', {
        operacao: 'discovery_v1',
        contexto: {
          interface: rede.interface,
          ipLocal: rede.ipLocal,
          mascara: rede.mascara,
          gateway: rede.gateway
        }
      });
      reportar('Interface encontrada', {
        interface: rede.interface,
        ipLocal: rede.ipLocal,
        mascara: rede.mascara
      });

      await log.info('Faixa calculada', {
        operacao: 'discovery_v1',
        contexto: {
          cidr: rede.cidr,
          faixaInicio: rede.faixaInicio,
          faixaFim: rede.faixaFim,
          totalHosts: rede.totalHosts
        }
      });
      reportar('Faixa calculada', {
        cidr: rede.cidr,
        faixaInicio: rede.faixaInicio,
        faixaFim: rede.faixaFim,
        totalHosts: rede.totalHosts,
        percentual: 5
      });

      const portScanner = new PortScanner({
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : 400,
        portas: Array.isArray(opcoes.portas) && opcoes.portas.length ? opcoes.portas : undefined
      });

      const abertos = await portScanner.escanearHosts(rede.hosts, {
        concorrencia: opcoes.concorrencia != null ? opcoes.concorrencia : 32,
        shouldCancel: () => this._cancelado,
        onProgress: ({ processados, total, percentual, host }) => {
          reportar('Host ativo encontrado', {
            host,
            processados,
            total,
            percentual: Math.min(95, Math.max(5, percentual))
          });
        }
      });

      const candidatos = [];
      for (const r of abertos) {
        await log.info('Porta aberta', {
          operacao: 'discovery_v1',
          contexto: { host: r.host, porta: r.porta, latencia: r.latencia }
        });
        reportar('Porta aberta', { host: r.host, porta: r.porta, latencia: r.latencia });

        const cand = new DeviceCandidate({
          host: r.host,
          porta: r.porta,
          transporte: 'TCP',
          status: 'ONLINE',
          latencia: r.latencia
        });
        candidatos.push(cand);
        await log.info('Equipamento descoberto', {
          operacao: 'discovery_v1',
          contexto: cand.paraLista()
        });
        reportar('Equipamento descoberto', cand.paraLista());
      }

      if (opcoes.persistir !== false) {
        await this.repository.salvarCandidatos(candidatos.map((c) => c.paraApi()));
      }

      const duracaoMs = Date.now() - iniciado;
      await log.info('Discovery finalizado', {
        operacao: 'discovery_v1',
        contexto: { encontrados: candidatos.length, duracaoMs }
      });
      reportar('Discovery finalizado', { percentual: 100, encontrados: candidatos.length });

      return {
        sucesso: true,
        equipamentos: candidatos.map((c) => c.paraLista()),
        candidatos: candidatos.map((c) => c.paraApi()),
        meta: {
          engine: 'v1.0',
          interface: rede.interface,
          ipLocal: rede.ipLocal,
          mascara: rede.mascara,
          gateway: rede.gateway,
          cidr: rede.cidr,
          faixaInicio: rede.faixaInicio,
          faixaFim: rede.faixaFim,
          hostsEscaneados: rede.totalHosts,
          portas: portScanner.portas,
          encontrados: candidatos.length,
          duracaoMs,
          cancelado: this._cancelado,
          progresso
        }
      };
    } catch (error) {
      await getLogger().error('Discovery falhou', {
        operacao: 'discovery_v1',
        contexto: { erro: error.message }
      });
      throw error;
    } finally {
      this._emExecucao = false;
    }
  }

  /**
   * Atalho: retorna apenas a lista enxuta do aceite da sprint.
   */
  async listarEquipamentos(opcoes = {}) {
    const out = await this.executar(opcoes);
    return out.equipamentos || [];
  }
}

const discoveryEngineV1 = new DiscoveryEngineV1();

/** RC14.12.3 — exportar instância + classe; nunca sobrescrever métodos da instância. */
module.exports = discoveryEngineV1;
module.exports.DiscoveryEngineV1 = DiscoveryEngineV1;
