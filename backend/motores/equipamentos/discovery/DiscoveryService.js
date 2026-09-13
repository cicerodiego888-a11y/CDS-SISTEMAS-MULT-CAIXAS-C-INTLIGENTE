'use strict';

/**
 * DiscoveryService — Discovery Engine Ethernet (RC1 / RC1.1 hardening).
 * Orquestra via DriverRegistry. Não cadastra equipamentos.
 */

const loggerService = require('../services/LoggerService');
const driverRegistry = require('../drivers/DriverRegistry');
const officialLoader = require('../sdk/OfficialDriverLoader');
const equipamentosRepository = require('../repositories/EquipamentosRepository');
const {
  criarDiscoveryResult,
  tentarCriarCandidate,
  sanitizarCandidatos
} = require('./CandidateDTO');
const {
  listarSubnetsLocais,
  expandirHostsCidr,
  parseCidr,
  mapPool,
  clamparConcorrencia,
  resetProbeStats,
  getProbeStats,
  CONCORRENCIA_PADRAO
} = require('./networkUtils');

const TRANSPORTES = {
  SERIAL: 'serial',
  USB: 'usb',
  ETHERNET: 'ethernet',
  BLUETOOTH: 'bluetooth',
  WIFI: 'wifi'
};

const DEFAULTS = {
  timeoutMs: 800,
  timeoutMsMin: 50,
  timeoutMsMax: 10000,
  concorrencia: CONCORRENCIA_PADRAO,
  maxHosts: 254
};

class DiscoveryService {
  constructor() {
    this._cancelado = false;
    this._emExecucao = false;
  }

  cancelar() {
    this._cancelado = true;
  }

  resetCancelamento() {
    this._cancelado = false;
  }

  estaCancelado() {
    return this._cancelado === true;
  }

  estaEmExecucao() {
    return this._emExecucao === true;
  }

  _garantirDrivers() {
    if (!officialLoader.estaCarregado()) {
      officialLoader.carregarTodos();
      return;
    }
    // Hot-reload se catálogo RC2 ainda não registrou serial/usb
    const serial = driverRegistry.buscarPorTransporte('serial');
    const usb = driverRegistry.buscarPorTransporte('usb');
    if (!serial.length || !usb.length) {
      officialLoader.reload();
    }
  }

  /**
   * Normaliza DiscoveryOptions (RC1.1).
   * @param {Object} [opcoes]
   * @returns {Object}
   */
  normalizarOpcoes(opcoes = {}) {
    const timeoutRaw = Number(opcoes.timeoutMs != null ? opcoes.timeoutMs : DEFAULTS.timeoutMs);
    const timeoutMs = Math.max(
      DEFAULTS.timeoutMsMin,
      Math.min(
        DEFAULTS.timeoutMsMax,
        Number.isFinite(timeoutRaw) ? timeoutRaw : DEFAULTS.timeoutMs
      )
    );
    const concorrencia = clamparConcorrencia(
      opcoes.concorrencia != null ? opcoes.concorrencia : DEFAULTS.concorrencia
    );
    const maxHosts = Math.max(1, Math.min(254, Number(opcoes.maxHosts) || DEFAULTS.maxHosts));

    return {
      ...opcoes,
      timeoutMs,
      concorrencia,
      maxHosts,
      hosts: Array.isArray(opcoes.hosts) ? opcoes.hosts.map(String).filter(Boolean) : undefined,
      portas: Array.isArray(opcoes.portas)
        ? opcoes.portas.map(Number).filter((p) => Number.isFinite(p) && p > 0 && p <= 65535)
        : undefined,
      driver_codigos: Array.isArray(opcoes.driver_codigos)
        ? opcoes.driver_codigos.map(String)
        : undefined,
      subnet: opcoes.subnet != null ? String(opcoes.subnet).trim() : undefined
    };
  }

  /**
   * @param {Object} [opcoes]
   * @returns {string}
   */
  resolverSubnet(opcoes = {}) {
    if (opcoes.subnet) {
      if (!parseCidr(opcoes.subnet)) {
        const err = new Error(`Subnet inválida: ${opcoes.subnet}`);
        err.code = 'SUBNET_INVALIDA';
        throw err;
      }
      return String(opcoes.subnet).trim();
    }
    const locais = listarSubnetsLocais();
    if (!locais.length) {
      const err = new Error('Nenhuma interface Ethernet IPv4 válida encontrada.');
      err.code = 'SUBNET_NAO_DETECTADA';
      throw err;
    }
    const preferida = locais.find((s) => s.bits < 32) || locais[0];
    return preferida.cidr;
  }

  /**
   * @param {Object[]} candidatos
   * @returns {Promise<Object[]>}
   */
  async _marcarJaCadastrados(candidatos) {
    const saida = [];
    for (const c of candidatos) {
      let ja = false;
      try {
        if (c.transporte === 'ethernet' && c.ip) {
          const existente = await equipamentosRepository.buscarPorIP(c.ip);
          if (existente) {
            const portaEq = Number(existente.porta_tcp || 0);
            const portaCand = Number(c.porta || 0);
            ja = !portaCand || !portaEq || portaEq === portaCand;
          }
        } else if (c.transporte === 'serial' && c.porta_com) {
          const existente = await equipamentosRepository.buscarPorPortaCom(c.porta_com);
          ja = Boolean(existente);
        } else if (c.transporte === 'usb' && (c.vid || c.caminho_dispositivo)) {
          const lista = await equipamentosRepository.listar({ todos: '1' });
          ja = (lista || []).some((eq) => {
            const obs = String(eq.observacao || '');
            if (c.caminho_dispositivo && obs.includes(c.caminho_dispositivo)) return true;
            if (c.vid && c.pid && obs.includes(`${c.vid}:${c.pid}`)) return true;
            return false;
          });
        }
      } catch (_) {
        ja = false;
      }
      const marcado = tentarCriarCandidate({ ...c, ja_cadastrado: ja });
      if (marcado) saida.push(marcado);
    }
    return saida;
  }

  _deduplicar(candidatos) {
    const mapa = new Map();
    for (const c of candidatos) {
      const chave = c.assinatura
        || `${c.transporte}|${c.ip || ''}|${c.porta || ''}|${c.driver_codigo || ''}`;
      const atual = mapa.get(chave);
      if (!atual || Number(c.confianca) > Number(atual.confianca)) {
        mapa.set(chave, c);
      }
    }
    return Array.from(mapa.values());
  }

  /**
   * Discovery Ethernet — RC1 / RC1.1.
   * @param {Object} [opcoes]
   * @returns {Promise<Object>} DiscoveryResult
   */
  async descobrirEthernet(opcoes = {}) {
    const interno = opcoes._interno === true;
    if (!interno) {
      this.resetCancelamento();
      this._emExecucao = true;
    }
    const iniciado = new Date();
    const memInicio = process.memoryUsage();
    const erros = [];
    let probesTotal = 0;
    let probesOk = 0;
    let subnet = null;

    try {
      if (!interno) resetProbeStats();
      const opts = this.normalizarOpcoes(opcoes);
      this._garantirDrivers();
      subnet = this.resolverSubnet(opts);

      const hosts = opts.hosts && opts.hosts.length
        ? opts.hosts
        : expandirHostsCidr(subnet, opts.maxHosts);

      if (!hosts.length) {
        erros.push({
          codigo: 'SUBNET_VAZIA',
          mensagem: `Nenhum host derivado da subnet ${subnet}`
        });
      }

      let drivers = driverRegistry.buscarPorTransporte('ethernet');
      if (opts.driver_codigos && opts.driver_codigos.length) {
        const filtro = new Set(opts.driver_codigos);
        drivers = drivers.filter((d) => filtro.has(d.codigo));
      }

      if (!drivers.length) {
        erros.push({
          codigo: 'SEM_DRIVERS_ETHERNET',
          mensagem: 'Nenhum driver Ethernet registrado no DriverRegistry.'
        });
      }

      const candidatosBrutos = [];

      for (const meta of drivers) {
        if (this._cancelado) {
          erros.push({
            codigo: 'DISCOVERY_CANCELADO',
            mensagem: 'Varredura cancelada pelo usuário.'
          });
          break;
        }
        try {
          const driver = driverRegistry.instanciar(meta.codigo, {});
          const resultado = await driver.descobrir({
            transporte: 'ethernet',
            subnet,
            hosts,
            timeoutMs: opts.timeoutMs,
            concorrencia: opts.concorrencia,
            portas: opts.portas,
            cancelado: () => this._cancelado
          });

          const lista = Array.isArray(resultado?.candidatos)
            ? resultado.candidatos
            : (Array.isArray(resultado) ? resultado : []);
          candidatosBrutos.push(...lista);

          if (Array.isArray(resultado?.erros)) {
            erros.push(...resultado.erros.map((e) => ({
              ...e,
              driver_codigo: meta.codigo
            })));
          }

          probesTotal += Number(resultado?.meta?.probes_total || 0);
          probesOk += Number(resultado?.meta?.probes_ok || 0);
        } catch (err) {
          erros.push({
            codigo: 'DRIVER_DISCOVERY_FALHOU',
            mensagem: err.message,
            driver_codigo: meta.codigo
          });
          await loggerService.error('Falha no discovery do driver', {
            operacao: 'discovery.driver',
            contexto: { driver: meta.codigo, erro: err.message }
          }).catch(() => {});
        }
      }

      if (probesTotal <= 0 && hosts.length && drivers.length) {
        probesTotal = hosts.length;
      }

      return await this._finalizarCandidatos({
        candidatosBrutos,
        erros,
        iniciado,
        memInicio,
        probesTotal,
        probesOk,
        metaExtra: {
          transportes_executados: ['ethernet'],
          subnet,
          hosts_total: hosts.length,
          concorrencia: opts.concorrencia,
          timeout_ms: opts.timeoutMs
        },
        sucessoSe: () => !erros.some((e) =>
          e.codigo === 'SUBNET_NAO_DETECTADA' || e.codigo === 'SUBNET_INVALIDA'
        )
      });
    } catch (err) {
      const finalizado = new Date();
      erros.push({
        codigo: err.code || 'DISCOVERY_ERRO',
        mensagem: err.message
      });
      return criarDiscoveryResult({
        sucesso: false,
        candidatos: [],
        erros,
        meta: {
          iniciado_em: iniciado.toISOString(),
          finalizado_em: finalizado.toISOString(),
          duracao_ms: finalizado - iniciado,
          probes_total: probesTotal,
          probes_ok: probesOk,
          transportes_executados: ['ethernet'],
          subnet
        }
      });
    } finally {
      if (!interno) this._emExecucao = false;
    }
  }

  /**
   * Discovery Serial — RC2.
   * @param {Object} [opcoes]
   */
  async descobrirSerial(opcoes = {}) {
    const interno = opcoes._interno === true;
    if (!interno) {
      this.resetCancelamento();
      this._emExecucao = true;
    }
    const iniciado = new Date();
    const memInicio = process.memoryUsage();
    const erros = [];
    let probesTotal = 0;
    let probesOk = 0;

    try {
      const opts = this.normalizarOpcoes({
        ...opcoes,
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : (opcoes.timeoutMsSerial != null ? opcoes.timeoutMsSerial : 500),
        concorrencia: opcoes.concorrencia != null ? opcoes.concorrencia : (opcoes.concorrenciaSerial != null ? opcoes.concorrenciaSerial : 4)
      });
      this._garantirDrivers();

      let drivers = driverRegistry.buscarPorTransporte('serial');
      if (opts.driver_codigos && opts.driver_codigos.length) {
        const filtro = new Set(opts.driver_codigos);
        drivers = drivers.filter((d) => filtro.has(d.codigo));
      }

      if (!drivers.length) {
        erros.push({
          codigo: 'SEM_DRIVERS_SERIAL',
          mensagem: 'Nenhum driver Serial registrado no DriverRegistry.'
        });
      }

      const candidatosBrutos = [];
      for (const meta of drivers) {
        if (this._cancelado) {
          erros.push({ codigo: 'DISCOVERY_CANCELADO', mensagem: 'Varredura serial cancelada.' });
          break;
        }
        try {
          const driver = driverRegistry.instanciar(meta.codigo, {});
          const resultado = await driver.descobrir({
            transporte: 'serial',
            timeoutMs: opts.timeoutMs,
            concorrencia: opts.concorrencia,
            portas_com: opts.portas_com,
            cancelado: () => this._cancelado
          });
          const lista = Array.isArray(resultado?.candidatos) ? resultado.candidatos : [];
          candidatosBrutos.push(...lista);
          if (Array.isArray(resultado?.erros)) {
            erros.push(...resultado.erros.map((e) => ({ ...e, driver_codigo: meta.codigo })));
          }
          probesTotal += Number(resultado?.meta?.probes_total || 0);
          probesOk += Number(resultado?.meta?.probes_ok || 0);
        } catch (err) {
          erros.push({
            codigo: 'DRIVER_DISCOVERY_FALHOU',
            mensagem: err.message,
            driver_codigo: meta.codigo,
            transporte: 'serial'
          });
        }
      }

      return await this._finalizarCandidatos({
        candidatosBrutos,
        erros,
        iniciado,
        memInicio,
        probesTotal,
        probesOk,
        metaExtra: {
          transportes_executados: ['serial'],
          concorrencia: opts.concorrencia,
          timeout_ms: opts.timeoutMs
        }
      });
    } catch (err) {
      erros.push({ codigo: err.code || 'DISCOVERY_SERIAL_ERRO', mensagem: err.message });
      return criarDiscoveryResult({
        sucesso: false,
        candidatos: [],
        erros,
        meta: {
          iniciado_em: iniciado.toISOString(),
          finalizado_em: new Date().toISOString(),
          duracao_ms: Date.now() - iniciado,
          probes_total: probesTotal,
          probes_ok: probesOk,
          transportes_executados: ['serial']
        }
      });
    } finally {
      if (!interno) this._emExecucao = false;
    }
  }

  /**
   * Discovery USB — RC2.
   * @param {Object} [opcoes]
   */
  async descobrirUsb(opcoes = {}) {
    const interno = opcoes._interno === true;
    if (!interno) {
      this.resetCancelamento();
      this._emExecucao = true;
    }
    const iniciado = new Date();
    const memInicio = process.memoryUsage();
    const erros = [];
    let probesTotal = 0;
    let probesOk = 0;

    try {
      const opts = this.normalizarOpcoes({
        ...opcoes,
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : (opcoes.timeoutMsUsb != null ? opcoes.timeoutMsUsb : 500),
        concorrencia: opcoes.concorrencia != null ? opcoes.concorrencia : (opcoes.concorrenciaUsb != null ? opcoes.concorrenciaUsb : 8)
      });
      this._garantirDrivers();

      let drivers = driverRegistry.buscarPorTransporte('usb');
      if (opts.driver_codigos && opts.driver_codigos.length) {
        const filtro = new Set(opts.driver_codigos);
        drivers = drivers.filter((d) => filtro.has(d.codigo));
      }

      if (!drivers.length) {
        erros.push({
          codigo: 'SEM_DRIVERS_USB',
          mensagem: 'Nenhum driver USB registrado no DriverRegistry.'
        });
      }

      const candidatosBrutos = [];
      for (const meta of drivers) {
        if (this._cancelado) {
          erros.push({ codigo: 'DISCOVERY_CANCELADO', mensagem: 'Varredura USB cancelada.' });
          break;
        }
        try {
          const driver = driverRegistry.instanciar(meta.codigo, {});
          const resultado = await driver.descobrir({
            transporte: 'usb',
            timeoutMs: opts.timeoutMs,
            concorrencia: opts.concorrencia,
            dispositivos_usb: opts.dispositivos_usb,
            cancelado: () => this._cancelado
          });
          const lista = Array.isArray(resultado?.candidatos) ? resultado.candidatos : [];
          candidatosBrutos.push(...lista);
          if (Array.isArray(resultado?.erros)) {
            erros.push(...resultado.erros.map((e) => ({ ...e, driver_codigo: meta.codigo })));
          }
          probesTotal += Number(resultado?.meta?.probes_total || 0);
          probesOk += Number(resultado?.meta?.probes_ok || 0);
        } catch (err) {
          erros.push({
            codigo: 'DRIVER_DISCOVERY_FALHOU',
            mensagem: err.message,
            driver_codigo: meta.codigo,
            transporte: 'usb'
          });
        }
      }

      return await this._finalizarCandidatos({
        candidatosBrutos,
        erros,
        iniciado,
        memInicio,
        probesTotal,
        probesOk,
        metaExtra: {
          transportes_executados: ['usb'],
          concorrencia: opts.concorrencia,
          timeout_ms: opts.timeoutMs
        }
      });
    } catch (err) {
      erros.push({ codigo: err.code || 'DISCOVERY_USB_ERRO', mensagem: err.message });
      return criarDiscoveryResult({
        sucesso: false,
        candidatos: [],
        erros,
        meta: {
          iniciado_em: iniciado.toISOString(),
          finalizado_em: new Date().toISOString(),
          duracao_ms: Date.now() - iniciado,
          probes_total: probesTotal,
          probes_ok: probesOk,
          transportes_executados: ['usb']
        }
      });
    } finally {
      if (!interno) this._emExecucao = false;
    }
  }

  /**
   * @private
   */
  async _finalizarCandidatos({
    candidatosBrutos,
    erros,
    iniciado,
    memInicio,
    probesTotal,
    probesOk,
    metaExtra = {},
    sucessoSe
  }) {
    const normalizados = candidatosBrutos
      .map((c) => validarOuReparar(c))
      .filter(Boolean);

    let candidatos = this._deduplicar(normalizados);
    candidatos = await this._marcarJaCadastrados(candidatos);
    const { candidatos: limpos, rejeitados } = sanitizarCandidatos(candidatos);
    candidatos = limpos;
    candidatos.sort((a, b) => Number(b.confianca) - Number(a.confianca));

    const finalizado = new Date();
    const memFim = process.memoryUsage();
    const probe = getProbeStats();
    const sucesso = typeof sucessoSe === 'function' ? sucessoSe() : true;

    return criarDiscoveryResult({
      sucesso,
      candidatos,
      erros,
      meta: {
        iniciado_em: iniciado.toISOString(),
        finalizado_em: finalizado.toISOString(),
        duracao_ms: finalizado - iniciado,
        probes_total: probesTotal,
        probes_ok: probesOk || candidatos.length,
        cancelado: this._cancelado,
        candidatos_rejeitados: rejeitados,
        sockets_probe_pico: probe.pico,
        sockets_probe_abertos: probe.abertos,
        map_pool_pico: mapPool._ultimoPicoInFlight || 0,
        memoria_rss_delta_bytes: memFim.rss - memInicio.rss,
        memoria_heap_delta_bytes: memFim.heapUsed - memInicio.heapUsed,
        ...metaExtra
      }
    });
  }

  /**
   * Multitransporte — RC2.
   * Cada transporte isola erros; um não interrompe os demais.
   * @param {Object} [opcoes]
   */
  async descobrirTodos(opcoes = {}) {
    this.resetCancelamento();
    this._emExecucao = true;
    resetProbeStats();
    const iniciado = new Date();

    const transportes = Array.isArray(opcoes.transportes) && opcoes.transportes.length
      ? opcoes.transportes.map((t) => String(t).toLowerCase())
      : ['ethernet', 'serial', 'usb'];

    const suportados = new Set(['ethernet', 'serial', 'usb']);
    const erros = [];
    const candidatosBrutos = [];
    let probesTotal = 0;
    let probesOk = 0;
    const transportesExecutados = [];

    try {
      for (const transporte of transportes) {
        if (this._cancelado) {
          erros.push({ codigo: 'DISCOVERY_CANCELADO', mensagem: 'Discovery cancelado.' });
          break;
        }
        if (!suportados.has(transporte)) {
          erros.push({
            codigo: 'TRANSPORTE_NAO_SUPORTADO',
            mensagem: `Transporte não suportado na RC2: ${transporte}`,
            transporte
          });
          continue;
        }

        try {
          let parcial;
          const internoOpts = { ...opcoes, _interno: true };
          if (transporte === 'ethernet') {
            parcial = await this.descobrirEthernet(internoOpts);
          } else if (transporte === 'serial') {
            parcial = await this.descobrirSerial(internoOpts);
          } else {
            parcial = await this.descobrirUsb(internoOpts);
          }

          transportesExecutados.push(transporte);
          candidatosBrutos.push(...(parcial.candidatos || []));
          if (Array.isArray(parcial.erros)) erros.push(...parcial.erros);
          probesTotal += Number(parcial.meta?.probes_total || 0);
          probesOk += Number(parcial.meta?.probes_ok || 0);
        } catch (err) {
          erros.push({
            codigo: 'TRANSPORTE_FALHOU',
            mensagem: err.message,
            transporte
          });
        }
      }

      let candidatos = this._deduplicar(candidatosBrutos);
      candidatos = await this._marcarJaCadastrados(candidatos);
      const { candidatos: limpos } = sanitizarCandidatos(candidatos);
      candidatos = limpos;
      candidatos.sort((a, b) => Number(b.confianca) - Number(a.confianca));

      const finalizado = new Date();
      const resultado = criarDiscoveryResult({
        sucesso: true,
        candidatos,
        erros,
        meta: {
          iniciado_em: iniciado.toISOString(),
          finalizado_em: finalizado.toISOString(),
          duracao_ms: finalizado - iniciado,
          probes_total: probesTotal,
          probes_ok: probesOk || candidatos.length,
          transportes_executados: transportesExecutados,
          cancelado: this._cancelado
        }
      });

      if (opcoes.persistir_sessao !== false) {
        try {
          const sessions = require('../repositories/DiscoverySessionsRepository');
          const sessao = await sessions.salvarSessao(resultado);
          return criarDiscoveryResult({
            sucesso: resultado.sucesso,
            candidatos: [...resultado.candidatos],
            erros: [...resultado.erros],
            meta: { ...resultado.meta, sessao_id: sessao?.id || null }
          });
        } catch (_) {
          return resultado;
        }
      }

      return resultado;
    } finally {
      this._emExecucao = false;
    }
  }

  async descobrirBluetooth() {
    return criarDiscoveryResult({
      sucesso: true,
      candidatos: [],
      erros: [{ codigo: 'TRANSPORTE_NAO_SUPORTADO', mensagem: 'Bluetooth na RC3+' }],
      meta: {
        iniciado_em: new Date().toISOString(),
        finalizado_em: new Date().toISOString(),
        duracao_ms: 0,
        probes_total: 0,
        probes_ok: 0,
        transportes_executados: []
      }
    });
  }

  async descobrirWifi() {
    return criarDiscoveryResult({
      sucesso: true,
      candidatos: [],
      erros: [{ codigo: 'TRANSPORTE_NAO_SUPORTADO', mensagem: 'Wi-Fi na RC3+' }],
      meta: {
        iniciado_em: new Date().toISOString(),
        finalizado_em: new Date().toISOString(),
        duracao_ms: 0,
        probes_total: 0,
        probes_ok: 0,
        transportes_executados: []
      }
    });
  }
}

function validarOuReparar(c) {
  if (!c) return null;
  return tentarCriarCandidate(c);
}

const discoveryService = new DiscoveryService();

module.exports = discoveryService;
module.exports.DiscoveryService = DiscoveryService;
module.exports.TRANSPORTES = TRANSPORTES;
module.exports.DEFAULTS = DEFAULTS;
module.exports.mapPool = mapPool;
