/**
 * DiagnosticoEquipamentos — Diagnóstico de equipamentos para o Laboratório.
 *
 * Usa EquipamentosManager sem acoplamento a driver específico.
 *
 * @class DiagnosticoEquipamentos
 */

const connectionMonitor = require('../monitor/ConnectionMonitor');

class DiagnosticoEquipamentos {
  /**
   * @returns {Object}
   * @private
   */
  _manager() {
    // eslint-disable-next-line global-require
    return require('../core/EquipamentosManager');
  }

  /**
   * @returns {Object}
   * @private
   */
  _repo() {
    // eslint-disable-next-line global-require
    return require('../repositories/EquipamentosRepository');
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async executar(equipamentoId) {
    const eq = await this._repo().buscarPorId(equipamentoId);
    if (!eq) {
      throw new Error(`Equipamento não encontrado: ${equipamentoId}`);
    }

    const manager = this._manager();
    const driver = await manager.obterDriver(equipamentoId);
    const info = typeof driver.informacoes === 'function' ? driver.informacoes() : {};

    const resultados = {
      equipamento_id: equipamentoId,
      timestamp: new Date().toISOString(),
      ping: await this.ping(equipamentoId).catch((e) => ({ sucesso: false, erro: e.message })),
      status: await this.status(equipamentoId).catch((e) => ({ sucesso: false, erro: e.message })),
      latencia: null,
      socket: await this.socket(equipamentoId, eq).catch((e) => ({ sucesso: false, erro: e.message })),
      heartbeat: await this.heartbeat(equipamentoId).catch((e) => ({ sucesso: false, erro: e.message })),
      driver: this.driver(info),
      modelo: this.modelo(info, eq),
      firmware: this.firmware(info),
      ip: this.ip(eq),
      porta: this.porta(eq),
      mac: this.mac(eq)
    };

    resultados.latencia = resultados.ping?.latencia_ms ?? resultados.ping?.tempo_ms ?? null;

    return resultados;
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async ping(equipamentoId) {
    const manager = this._manager();
    const driver = await manager.obterDriver(equipamentoId);
    if (!driver.protocol?.conectado) {
      await manager.conectar(equipamentoId);
    }
    if (typeof driver.protocol?.ping === 'function') {
      return driver.protocol.ping();
    }
    throw new Error('Driver não suporta ping de protocolo');
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async status(equipamentoId) {
    const manager = this._manager();
    return manager.status(equipamentoId);
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async latencia(equipamentoId) {
    const ping = await this.ping(equipamentoId);
    return {
      ms: ping.latencia_ms ?? ping.tempo_ms ?? null,
      detalhe: ping
    };
  }

  /**
   * @param {number|string} equipamentoId
   * @param {Object} [equipamento]
   * @returns {Object}
   */
  async socket(equipamentoId, equipamento) {
    const eq = equipamento || await this._repo().buscarPorId(equipamentoId);
    const chave = eq?.id != null ? `eq:${eq.id}` : `${eq?.ip}:${eq?.porta_tcp || 9000}`;
    const monitor = connectionMonitor.obterStatus(chave);
    return {
      conectado: monitor.conectado === true,
      chave,
      host: eq?.ip,
      porta: eq?.porta_tcp || 9000,
      monitor
    };
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async heartbeat(equipamentoId) {
    const manager = this._manager();
    const driver = await manager.obterDriver(equipamentoId);
    if (!driver.protocol?.conectado) {
      await manager.conectar(equipamentoId);
    }
    if (typeof driver.protocol?.heartbeat === 'function') {
      return driver.protocol.heartbeat();
    }
    throw new Error('Driver não suporta heartbeat');
  }

  driver(info) {
    return {
      codigo: info.codigo || null,
      fabricante: info.fabricante || null,
      versao: info.versao || null
    };
  }

  modelo(info, eq) {
    return info.modelo || eq?.modelo || null;
  }

  firmware(info) {
    return info.firmware_conhecido || info.firmware || null;
  }

  ip(eq) {
    return eq?.ip || null;
  }

  porta(eq) {
    return eq?.porta_tcp ?? 9000;
  }

  mac(eq) {
    return eq?.mac || eq?.endereco_mac || null;
  }
}

const diagnosticoEquipamentos = new DiagnosticoEquipamentos();

module.exports = diagnosticoEquipamentos;
module.exports.DiagnosticoEquipamentos = DiagnosticoEquipamentos;
