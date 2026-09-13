/**
 * ConnectionManager — Gerenciamento de conexões TCP reutilizáveis.
 *
 * Responsabilidades:
 * - Abrir e reutilizar conexões por equipamento
 * - Fechar conexões
 * - Timeout e heartbeat
 * - Reconexão automática
 *
 * @class ConnectionManager
 */

const EthernetTransport = require('./EthernetTransport');
const loggerService = require('../services/LoggerService');

const HEARTBEAT_PADRAO_MS = Number(process.env.EQUIPAMENTOS_HEARTBEAT_MS || 30000);

class ConnectionManager {
  constructor() {
    /** @type {Map<string, Object>} */
    this._conexoes = new Map();
    this._heartbeatPadrao = HEARTBEAT_PADRAO_MS;
  }

  /**
   * @param {Object} config
   * @returns {string}
   * @private
   */
  _chave(config) {
    if (config.equipamento_id != null) return `eq:${config.equipamento_id}`;
    const host = config.host || config.ip || '127.0.0.1';
    const porta = config.porta || config.port || require('../drivers/toledo/ToledoProtocol').PORTA_PADRAO;
    return `${host}:${porta}`;
  }

  /**
   * @param {string} chave
   * @param {Object} entrada
   * @private
   */
  _iniciarHeartbeat(chave, entrada) {
    this._pararHeartbeat(entrada);

    const intervalo = entrada.config.heartbeatInterval ?? this._heartbeatPadrao;
    if (!intervalo || intervalo <= 0) return;

    entrada.heartbeatTimer = setInterval(async () => {
      try {
        if (!entrada.transport.isConnected()) {
          await this.reconectar(chave);
          return;
        }
        await entrada.transport.ping();
        entrada.ultimoHeartbeat = new Date().toISOString();
      } catch (err) {
        entrada.ultimoErro = err.message;
        await loggerService.warn('Heartbeat falhou', {
          operacao: 'connection.heartbeat',
          equipamento_id: entrada.config.equipamento_id ?? null,
          contexto: { erro: err.message, chave }
        });
      }
    }, intervalo);
  }

  /**
   * @param {Object} entrada
   * @private
   */
  _pararHeartbeat(entrada) {
    if (entrada.heartbeatTimer) {
      clearInterval(entrada.heartbeatTimer);
      entrada.heartbeatTimer = null;
    }
  }

  /**
   * Abre ou reutiliza conexão TCP.
   * @param {Object} config - { equipamento_id, host/ip, porta, timeout, tentativas, intervaloReconexao }
   * @returns {Promise<Object>}
   */
  async abrir(config = {}) {
    const chave = this._chave(config);
    const existente = this._conexoes.get(chave);

    if (existente && existente.transport.isConnected()) {
      return existente;
    }

    if (existente) {
      await this.fechar(chave);
    }

    const transport = new EthernetTransport(config);
    await transport.connect();

    const tentativasAnteriores = existente?.tentativasConexao ?? 0;

    const entrada = {
      chave,
      transport,
      config,
      conectadoEm: Date.now(),
      ultimoErro: null,
      ultimoHeartbeat: null,
      heartbeatTimer: null,
      tentativasConexao: tentativasAnteriores + 1,
      reconexoes: existente?.reconexoes ?? 0
    };

    this._conexoes.set(chave, entrada);
    this._iniciarHeartbeat(chave, entrada);

    await loggerService.info('Conexão aberta', {
      operacao: 'connection.abrir',
      equipamento_id: config.equipamento_id ?? null,
      contexto: { chave, host: config.host || config.ip, porta: config.porta }
    });

    return entrada;
  }

  /**
   * @param {string|number} chaveOuEquipamentoId
   * @returns {Object|null}
   */
  obter(chaveOuEquipamentoId) {
    const chave = String(chaveOuEquipamentoId).includes(':')
      ? String(chaveOuEquipamentoId)
      : `eq:${chaveOuEquipamentoId}`;
    return this._conexoes.get(chave) || null;
  }

  /**
   * @param {string|number} chaveOuEquipamentoId
   * @returns {Object}
   */
  obterStatus(chaveOuEquipamentoId) {
    const entrada = this.obter(chaveOuEquipamentoId);
    if (!entrada) {
      return {
        conectado: false,
        status: 'desconectado',
        tempo_conexao_ms: 0,
        ultimo_erro: null,
        ultimo_heartbeat: null
      };
    }

    const conectado = entrada.transport.isConnected();
    return {
      conectado,
      status: conectado ? 'conectado' : 'desconectado',
      host: entrada.config.host || entrada.config.ip,
      porta: entrada.config.porta || entrada.config.port,
      tempo_conexao_ms: entrada.transport.obterTempoConexaoMs(),
      conectado_em: entrada.conectadoEm ? new Date(entrada.conectadoEm).toISOString() : null,
      ultimo_erro: entrada.ultimoErro || entrada.transport.obterUltimoErro(),
      ultimo_heartbeat: entrada.ultimoHeartbeat,
      tentativas: entrada.tentativasConexao ?? 0,
      reconexoes: entrada.reconexoes ?? 0,
      comunicacao_real: true
    };
  }

  /**
   * @param {string|number} chaveOuEquipamentoId
   * @returns {Promise<boolean>}
   */
  async fechar(chaveOuEquipamentoId) {
    const chave = String(chaveOuEquipamentoId).includes(':')
      ? String(chaveOuEquipamentoId)
      : `eq:${chaveOuEquipamentoId}`;

    const entrada = this._conexoes.get(chave);
    if (!entrada) return false;

    this._pararHeartbeat(entrada);

    try {
      await entrada.transport.disconnect();
    } catch (err) {
      entrada.ultimoErro = err.message;
    }

    this._conexoes.delete(chave);

    await loggerService.info('Conexão fechada', {
      operacao: 'connection.fechar',
      equipamento_id: entrada.config.equipamento_id ?? null,
      contexto: { chave }
    });

    return true;
  }

  /**
   * @param {string|number} chaveOuEquipamentoId
   * @returns {Promise<Object>}
   */
  async reconectar(chaveOuEquipamentoId) {
    const chave = String(chaveOuEquipamentoId).includes(':')
      ? String(chaveOuEquipamentoId)
      : `eq:${chaveOuEquipamentoId}`;

    const entrada = this._conexoes.get(chave);
    if (!entrada) {
      throw new Error(`Conexão não encontrada: ${chave}`);
    }

    try {
      const resultado = await entrada.transport.reconnect();
      entrada.conectadoEm = Date.now();
      entrada.ultimoErro = null;
      entrada.reconexoes = (entrada.reconexoes || 0) + 1;
      return resultado;
    } catch (err) {
      entrada.ultimoErro = err.message;
      throw err;
    }
  }

  /**
   * @returns {Object[]}
   */
  listarAtivas() {
    return Array.from(this._conexoes.values()).map((e) => this.obterStatus(e.chave.replace('eq:', '')));
  }

  /**
   * Fecha todas as conexões (shutdown).
   * @returns {Promise<number>}
   */
  async fecharTodas() {
    const chaves = Array.from(this._conexoes.keys());
    for (const chave of chaves) {
      await this.fechar(chave);
    }
    return chaves.length;
  }

  /**
   * Reinicia estado (testes).
   */
  reiniciar() {
    for (const entrada of this._conexoes.values()) {
      this._pararHeartbeat(entrada);
      if (entrada.transport.isConnected()) {
        entrada.transport.disconnect().catch(() => {});
      }
    }
    this._conexoes.clear();
  }
}

const connectionManager = new ConnectionManager();

module.exports = connectionManager;
module.exports.ConnectionManager = ConnectionManager;
