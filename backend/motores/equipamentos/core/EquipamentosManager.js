/**
 * EquipamentosManager — Orquestrador central do Motor de Equipamentos
 *
 * Sprint 11A: ponto único de acesso a drivers — camadas superiores
 * NÃO devem instanciar drivers diretamente.
 *
 * @class EquipamentosManager
 */

const driverManager = require('./DriverManager');
const queueManager = require('../queue/QueueManager');
const equipamentosEvents = require('../events/EquipamentosEvents');
const configService = require('../services/ConfigService');
const loggerService = require('../services/LoggerService');
const syncManager = require('../services/SyncManager');
const equipamentosRepository = require('../repositories/EquipamentosRepository');

class EquipamentosManager {
  constructor() {
    /** @type {boolean} */
    this._inicializado = false;
    /** @type {Map<string|number, { driver: Object, configHash: string }>} */
    this._driversAtivos = new Map();
  }

  /**
   * @param {Object} equipamento
   * @returns {Object}
   * @private
   */
  _configFromEquipamento(equipamento) {
    return {
      equipamento_id: equipamento.id,
      host: equipamento.ip,
      ip: equipamento.ip,
      porta: equipamento.porta_tcp || require('../drivers/toledo/ToledoProtocol').PORTA_PADRAO,
      timeout: equipamento.timeout_ms ?? 5000,
      timeout_ms: equipamento.timeout_ms ?? 5000,
      reconnect_auto: equipamento.reconnect_auto,
      driver_codigo: equipamento.driver_codigo,
      fabricante: equipamento.fabricante,
      modelo: equipamento.modelo,
      firmware: equipamento.firmware ?? null,
      protocolo_versao: equipamento.protocolo_versao ?? null,
      driver: equipamento.driver_codigo || 'TOLEDO_PRIX4_UNO'
    };
  }

  /**
   * Inicializa subsistemas do motor (fila).
   * @param {Object} [opcoes]
   * @returns {Promise<void>}
   */
  async inicializar(opcoes = {}) {
    if (this._inicializado) return;

    const config = await configService.obterConfiguracaoGlobal();
    if (!config.habilitado) {
      await loggerService.warn('Motor de equipamentos desabilitado na configuração global', {
        operacao: 'manager.inicializar'
      });
    }

    queueManager.iniciar(opcoes.queue || {});
    this._inicializado = true;

    await loggerService.info('EquipamentosManager inicializado', {
      operacao: 'manager.inicializar'
    });
  }

  /**
   * Encerra subsistemas e desconecta drivers ativos.
   * @returns {Promise<void>}
   */
  async encerrar() {
    queueManager.parar();

    for (const [equipamentoId] of this._driversAtivos) {
      try {
        await this.desconectar(equipamentoId);
      } catch (_) {
        // ignora falhas no shutdown
      }
    }

    this._driversAtivos.clear();
    this._inicializado = false;

    await loggerService.info('EquipamentosManager encerrado', {
      operacao: 'manager.encerrar'
    });
  }

  /**
   * @returns {boolean}
   */
  estaInicializado() {
    return this._inicializado;
  }

  /**
   * Obtém driver ativo para um equipamento cadastrado.
   * @param {number|string} equipamentoId
   * @returns {Promise<import('../drivers/BaseDriver')>}
   */
  async obterDriver(equipamentoId) {
    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) {
      throw new Error(`Equipamento não encontrado: ${equipamentoId}`);
    }

    if (!equipamento.driver_codigo && (!equipamento.fabricante || !equipamento.modelo)) {
      throw new Error(`Equipamento ${equipamentoId} sem driver configurado`);
    }

    const config = this._configFromEquipamento(equipamento);
    const configHash = JSON.stringify(config);
    const cached = this._driversAtivos.get(equipamentoId);

    if (cached && cached.configHash === configHash) {
      return cached.driver;
    }

    let driver;
    if (equipamento.driver_codigo) {
      const registro = driverManager.buscarDriverPorCodigo(equipamento.driver_codigo);
      if (!registro) {
        throw new Error(`Driver não registrado: ${equipamento.driver_codigo}`);
      }
      driver = driverManager.registry.instanciar(equipamento.driver_codigo, config);
    } else {
      driver = driverManager.obterDriver(equipamento.fabricante, equipamento.modelo, config);
    }

    this._driversAtivos.set(equipamentoId, { driver, configHash });
    return driver;
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async conectar(equipamentoId) {
    const driver = await this.obterDriver(equipamentoId);
    const resultado = await driver.conectar();

    await equipamentosRepository.atualizarComunicacao(equipamentoId, {
      status: 'online',
      ultimoErro: null
    });

    return resultado;
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async desconectar(equipamentoId) {
    const cached = this._driversAtivos.get(equipamentoId);
    if (!cached) {
      return { sucesso: true, mensagem: 'Driver não estava em cache' };
    }

    const resultado = await cached.driver.desconectar();
    this._driversAtivos.delete(equipamentoId);

    await equipamentosRepository.atualizarComunicacao(equipamentoId, {
      status: 'offline'
    });

    return resultado;
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async status(equipamentoId) {
    const driver = await this.obterDriver(equipamentoId);
    return driver.status();
  }

  /**
   * @param {number|string} equipamentoId
   * @param {Object} produto
   * @returns {Promise<Object>}
   */
  async sincronizarProduto(equipamentoId, produto) {
    return this._executarSync(equipamentoId, 'sincronizarProduto', produto);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {Object} departamento
   * @returns {Promise<Object>}
   */
  async sincronizarDepartamento(equipamentoId, departamento) {
    return this._executarSync(equipamentoId, 'sincronizarDepartamento', departamento);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {Object} promocao
   * @returns {Promise<Object>}
   */
  async sincronizarPromocao(equipamentoId, promocao) {
    return this._executarSync(equipamentoId, 'sincronizarPromocao', promocao);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {Object} etiqueta
   * @returns {Promise<Object>}
   */
  async sincronizarEtiqueta(equipamentoId, etiqueta) {
    return this._executarSync(equipamentoId, 'sincronizarEtiqueta', etiqueta);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {string} metodo
   * @param {Object} entidade
   * @returns {Promise<Object>}
   * @private
   */
  async _executarSync(equipamentoId, metodo, entidade) {
    const driver = await this.obterDriver(equipamentoId);

    if (!driver.protocol?.conectado) {
      await this.conectar(equipamentoId);
    }

    if (typeof driver[metodo] !== 'function') {
      throw new Error(`Método ${metodo} não suportado pelo driver`);
    }

    const resultado = await driver[metodo](entidade);

    await equipamentosRepository.atualizarComunicacao(equipamentoId, {
      status: resultado.sucesso !== false ? 'online' : 'erro',
      ultimoErro: resultado.sucesso === false ? (resultado.protocolo?.nakDetalhe?.mensagem || 'falha sync') : null
    });

    return resultado;
  }

  /**
   * Solicita sincronização via fila (SyncManager).
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async sincronizar(params) {
    return syncManager.sincronizar(params);
  }

  /**
   * @returns {Promise<Object>}
   */
  async diagnosticar() {
    return {
      sucesso: true,
      inicializado: this._inicializado,
      drivers_em_cache: this._driversAtivos.size,
      fila_pendentes: await queueManager.contarPendentes()
    };
  }
}

const equipamentosManager = new EquipamentosManager();

module.exports = equipamentosManager;
