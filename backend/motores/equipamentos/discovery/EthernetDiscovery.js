/**
 * Sprint 15.0 — EthernetDiscovery
 * Descoberta automática de equipamentos TCP/IP na rede local.
 *
 * Fluxo: interfaces → sub-rede → TcpScanner → ProbeExecutor → CandidateBuilder
 */

'use strict';

const NetworkScanner = require('./NetworkScanner');
const TcpScanner = require('./TcpScanner');
const ProbeExecutor = require('./ProbeExecutor');
const CandidateBuilder = require('./CandidateBuilder');
const DiscoveryLabLogger = require('./DiscoveryLabLogger');
const DiscoveryRepository = require('./DiscoveryRepository');

const DEFAULT_CONFIG = Object.freeze({
  timeoutTcpMs: 200,
  timeoutProbeMs: 500,
  concorrencia: 50,
  portasPadrao: [9000],
  detectarInterfaces: true,
  maxHosts: 254,
  incluirTcpSemMatch: false
});

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[ethernet-discovery]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[ethernet-discovery]', msg, ctx || '')
    };
  }
  return logger;
}

function coletarDriversEthernet() {
  const saida = [];
  try {
    const driverLoader = require('../drivers/DriverLoader');
    const driverRegistry = require('../drivers/DriverRegistry');
    if (!driverLoader.estaCarregado()) {
      driverLoader.carregarTodos();
    }
    const metas = driverRegistry.buscarPorTransporte('ethernet') || [];
    for (const meta of metas) {
      let instancia = null;
      try {
        instancia = driverRegistry.instanciar(meta.codigo, {});
      } catch (_) {
        continue;
      }
      const discovery = resolverDiscoveryMeta(instancia, meta);
      if (!discovery || discovery.transport !== 'ethernet') continue;
      saida.push({
        codigo: meta.codigo,
        instancia,
        discovery,
        priority: Number(discovery.priority) || 100
      });
    }
  } catch (_) { /* registry indisponível */ }

  saida.sort((a, b) => a.priority - b.priority);
  return saida;
}

function resolverDiscoveryMeta(instancia, meta = {}) {
  if (instancia?.constructor?.discovery) {
    return normalizarDiscovery(instancia.constructor.discovery);
  }
  if (typeof instancia?.getDiscoveryProfile === 'function') {
    return normalizarDiscovery(instancia.getDiscoveryProfile());
  }
  if (instancia?.discoveryProfile) {
    return normalizarDiscovery(instancia.discoveryProfile);
  }
  // Fallback: driver ethernet genérico → porta 9000
  return normalizarDiscovery({
    transport: 'ethernet',
    ports: DEFAULT_CONFIG.portasPadrao,
    timeout: DEFAULT_CONFIG.timeoutProbeMs,
    priority: 50,
    driver: meta.codigo
  });
}

function normalizarDiscovery(raw = {}) {
  const ports = Array.isArray(raw.ports) && raw.ports.length
    ? raw.ports.map(Number).filter((p) => p > 0 && p <= 65535)
    : [...DEFAULT_CONFIG.portasPadrao];
  return {
    transport: String(raw.transport || 'ethernet').toLowerCase(),
    ports,
    timeout: Math.max(100, Number(raw.timeout) || DEFAULT_CONFIG.timeoutProbeMs),
    priority: Number(raw.priority) || 100,
    driver: raw.driver || null
  };
}

class EthernetDiscovery {
  constructor(deps = {}) {
    this.networkScanner = deps.networkScanner || new NetworkScanner();
    this.candidateBuilder = deps.candidateBuilder || new CandidateBuilder();
    this.repository = deps.repository || new DiscoveryRepository();
    this.labLogger = deps.labLogger || new DiscoveryLabLogger();
    this.probeExecutor = deps.probeExecutor || new ProbeExecutor({ labLogger: this.labLogger });
    this._cancelado = false;
    this._emExecucao = false;
    this._ultimoResultado = null;
    this.config = { ...DEFAULT_CONFIG };
  }

  configurar(parcial = {}) {
    this.config = { ...this.config, ...parcial };
    return this.config;
  }

  cancelar() {
    this._cancelado = true;
  }

  estaEmExecucao() {
    return this._emExecucao === true;
  }

  obterUltimoResultado() {
    return this._ultimoResultado;
  }

  /**
   * Executa descoberta Ethernet completa.
   * @param {object} [opcoes]
   */
  async executar(opcoes = {}) {
    if (this._emExecucao) {
      const err = new Error('Discovery Ethernet já em execução.');
      err.code = 'DISCOVERY_EM_EXECUCAO';
      err.statusCode = 409;
      throw err;
    }

    this._cancelado = false;
    this._emExecucao = true;
    const iniciado = Date.now();
    const cfg = { ...this.config, ...opcoes };
    const log = getLogger();

    try {
      await this.labLogger.iniciar({ driver: 'ETHERNET_DISCOVERY', persistir: cfg.lab !== false });
      this.probeExecutor.limparLogs();

      await log.info('Ethernet Discovery iniciado', { operacao: 'ethernet_discovery' });

      const rede = this.networkScanner.descobrirRede({
        maxHosts: Number(cfg.maxHosts) || DEFAULT_CONFIG.maxHosts
      });
      const subRedes = Array.isArray(rede.subRedes) && rede.subRedes.length
        ? rede.subRedes.map((s) => ({ ip: s.ip, subnet: s.subnet, broadcast: s.broadcast }))
        : [{ ip: rede.ipLocal, subnet: rede.cidr, broadcast: rede.broadcast }];

      const drivers = coletarDriversEthernet();
      const portas = this._resolverPortas(cfg, drivers);

      const tcpScanner = new TcpScanner({
        timeoutMs: cfg.timeoutTcpMs != null ? cfg.timeoutTcpMs : DEFAULT_CONFIG.timeoutTcpMs,
        concorrencia: cfg.concorrencia != null ? cfg.concorrencia : DEFAULT_CONFIG.concorrencia,
        portas
      });

      const abertos = await tcpScanner.escanear(rede.hosts, {
        portas,
        concorrencia: cfg.concorrencia,
        timeoutMs: cfg.timeoutTcpMs,
        shouldCancel: () => this._cancelado,
        onProgress: cfg.onProgress
      });

      const candidatos = [];
      const endpointsIdentificados = new Set();

      for (const aberto of abertos) {
        if (this._cancelado) break;
        const chave = `${aberto.host}:${aberto.porta}`;
        const driversPorta = drivers.filter((d) => d.discovery.ports.includes(Number(aberto.porta)));
        const candidatosDriver = driversPorta.length ? driversPorta : drivers;

        let identificado = false;
        for (const drv of candidatosDriver) {
          if (this._cancelado) break;
          const probe = await this.probeExecutor.executar(aberto, drv, {
            timeoutMs: drv.discovery.timeout || cfg.timeoutProbeMs
          });
          if (!probe.sucesso) continue;

          const cand = this.candidateBuilder.construir(probe, {
            timeout: drv.discovery.timeout,
            fabricante: probe.identidade?.fabricante,
            modelo: probe.identidade?.modelo
          });
          if (cand) {
            candidatos.push(cand);
            endpointsIdentificados.add(chave);
            identificado = true;
            break; // primeiro driver com match (já ordenado por priority)
          }
        }

        if (!identificado && cfg.incluirTcpSemMatch) {
          const fraco = this.candidateBuilder.construirTcpAberto(aberto);
          if (fraco) candidatos.push(fraco);
        }
      }

      const labLogs = await this.labLogger.finalizar();
      const tcpStats = tcpScanner.obterEstatisticas();
      const duracaoMs = Date.now() - iniciado;

      const estatisticas = {
        ethernet: true,
        hostsAnalisados: tcpStats.hostsAnalisados,
        hostsConectados: tcpStats.hostsConectados,
        equipamentosEncontrados: candidatos.length,
        tempoTotal: duracaoMs,
        tempoMedio: tcpStats.tempoMedioMs,
        portasAbertas: tcpStats.portasAbertas,
        timeouts: tcpStats.timeouts,
        probes: tcpStats.probes,
        portas: portas,
        subRedes
      };

      if (cfg.persistir !== false) {
        try {
          await this.repository.salvarCandidatos(candidatos.map((c) => ({
            host: c.ip,
            porta: c.porta,
            transporte: 'TCP',
            status: 'ONLINE',
            latencia: c.latencia
          })));
        } catch (_) { /* persistência opcional */ }
      }

      await log.info('Ethernet Discovery finalizado', {
        operacao: 'ethernet_discovery',
        contexto: estatisticas
      });

      this._ultimoResultado = {
        sucesso: true,
        candidatos,
        equipamentos: candidatos.map((c) => ({
          endpoint: c.endpoint,
          driver: c.driver,
          confiança: c.confiança,
          confianca: c.confianca,
          transporte: c.transporte,
          ip: c.ip,
          porta: c.porta,
          fabricante: c.fabricante,
          modelo: c.modelo
        })),
        meta: {
          engine: 'ethernet-15.0',
          interface: rede.interface,
          ipLocal: rede.ipLocal,
          mascara: rede.mascara,
          gateway: rede.gateway,
          cidr: rede.cidr,
          broadcast: rede.broadcast,
          subRedes,
          drivers: drivers.map((d) => d.codigo),
          estatisticas,
          configuracao: {
            timeoutTcpMs: cfg.timeoutTcpMs != null ? cfg.timeoutTcpMs : DEFAULT_CONFIG.timeoutTcpMs,
            portasPadrao: portas,
            maxConexoesSimultaneas: cfg.concorrencia != null ? cfg.concorrencia : DEFAULT_CONFIG.concorrencia,
            detectarInterfaces: cfg.detectarInterfaces !== false,
            subRedesPermitidas: 'automatico'
          },
          lab: {
            registros: labLogs.length,
            probes: this.probeExecutor.obterLogs()
          },
          cancelado: this._cancelado,
          duracaoMs
        }
      };

      return this._ultimoResultado;
    } catch (error) {
      await getLogger().error('Ethernet Discovery falhou', {
        operacao: 'ethernet_discovery',
        contexto: { erro: error.message }
      });
      try { await this.labLogger.finalizar(); } catch (_) { /* ignore */ }
      throw error;
    } finally {
      this._emExecucao = false;
    }
  }

  _resolverPortas(cfg, drivers) {
    if (Array.isArray(cfg.portas) && cfg.portas.length) {
      return cfg.portas.map(Number).filter((p) => p > 0 && p <= 65535);
    }
    const set = new Set();
    for (const d of drivers) {
      for (const p of d.discovery.ports || []) set.add(Number(p));
    }
    if (!set.size) {
      for (const p of DEFAULT_CONFIG.portasPadrao) set.add(p);
    }
    return Array.from(set).sort((a, b) => a - b);
  }
}

const ethernetDiscovery = new EthernetDiscovery();

/** RC14.12.3 — exportar instância + classe/helpers; nunca sobrescrever métodos da instância. */
module.exports = ethernetDiscovery;
module.exports.EthernetDiscovery = EthernetDiscovery;
module.exports.coletarDriversEthernet = coletarDriversEthernet;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
