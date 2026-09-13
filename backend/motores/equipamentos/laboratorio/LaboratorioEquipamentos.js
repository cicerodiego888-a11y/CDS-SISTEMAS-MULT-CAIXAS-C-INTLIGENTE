/**
 * LaboratorioEquipamentos — Fachada do Laboratório de Engenharia.
 *
 * Orquestra FrameStudio, PacketInspector, CaptureManager, ReplayManager,
 * PacketComparator e DiagnosticoEquipamentos.
 *
 * Genérico para qualquer driver — sem dependência direta de Toledo.
 *
 * @class LaboratorioEquipamentos
 */

const frameStudio = require('./FrameStudio');
const packetInspector = require('./PacketInspector');
const captureManager = require('./CaptureManager');
const replayManager = require('./ReplayManager');
const packetComparator = require('./PacketComparator');
const diagnosticoEquipamentos = require('./DiagnosticoEquipamentos');
const { listarDriversComFrameBuilder } = require('./frameBuilderMap');
const driverManager = require('../core/DriverManager');
const equipamentosRepository = require('../repositories/EquipamentosRepository');
const loggerService = require('../services/LoggerService');

class LaboratorioEquipamentos {
  constructor() {
    /** @type {Map<string|number, Object>} */
    this._sessoes = new Map();
    this._inicializarHookPacotes();
  }

  /**
   * Conecta PacketLogger ao laboratório via hook adicionado em Sprint 12.
   * @private
   */
  _inicializarHookPacotes() {
    try {
      const packetLogger = require('../communication/PacketLogger');
      if (typeof packetLogger.adicionarListener === 'function') {
        packetLogger.adicionarListener((entry) => this._onPacote(entry));
      }
    } catch (_) {
      // hook opcional
    }
  }

  /**
   * @param {Object} entry
   * @private
   */
  _onPacote(entry) {
    const enriquecido = packetInspector.registrarPacote(entry);
    if (captureManager.estaCapturando()) {
      captureManager.registrarPacote(enriquecido);
    }
  }

  /**
   * @returns {Object}
   */
  _manager() {
    // eslint-disable-next-line global-require
    return require('../core/EquipamentosManager');
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async _obterProtocolo(equipamentoId) {
    const manager = this._manager();
    const driver = await manager.obterDriver(equipamentoId);
    if (!driver.protocol) {
      throw new Error('Driver sem camada de protocolo');
    }
    return driver.protocol;
  }

  /**
   * Lista drivers disponíveis no laboratório.
   * @returns {Promise<Object[]>}
   */
  async listarDrivers() {
    driverManager.listarDriversCompleto?.();
    const catalogo = await driverManager.listarDriversCompleto();
    const comFrame = new Set(listarDriversComFrameBuilder());
    return catalogo.map((d) => ({
      ...d,
      laboratorio_frame_builder: comFrame.has(d.codigo)
    }));
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async conectar(equipamentoId) {
    const eq = await equipamentosRepository.buscarPorId(equipamentoId);
    const resultado = await this._manager().conectar(equipamentoId);
    this._sessoes.set(equipamentoId, {
      equipamento_id: equipamentoId,
      driver_codigo: eq?.driver_codigo,
      conectado_em: new Date().toISOString()
    });
    return resultado;
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async desconectar(equipamentoId) {
    const resultado = await this._manager().desconectar(equipamentoId);
    this._sessoes.delete(equipamentoId);
    return resultado;
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async ping(equipamentoId) {
    return diagnosticoEquipamentos.ping(equipamentoId);
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async status(equipamentoId) {
    return diagnosticoEquipamentos.status(equipamentoId);
  }

  /**
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async diagnostico(equipamentoId) {
    return diagnosticoEquipamentos.executar(equipamentoId);
  }

  /**
   * @param {Object} params
   * @returns {Object}
   */
  montarFrame(params = {}) {
    const { driver_codigo, comando, payload } = params;
    return frameStudio.montarFrame(driver_codigo, comando, payload);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {string} hex
   * @returns {Promise<Object>}
   */
  async enviarHex(equipamentoId, hex) {
    const { buffer } = frameStudio.hexParaAscii(hex);
    return this._enviarRaw(equipamentoId, buffer);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {string} ascii
   * @returns {Promise<Object>}
   */
  async enviarAscii(equipamentoId, ascii) {
    const buffer = Buffer.from(String(ascii || ''), 'utf8');
    return this._enviarRaw(equipamentoId, buffer);
  }

  /**
   * @param {number|string} equipamentoId
   * @param {Buffer} buffer
   * @returns {Promise<Object>}
   * @private
   */
  async _enviarRaw(equipamentoId, buffer) {
    const protocol = await this._obterProtocolo(equipamentoId);
    if (!protocol.conectado) {
      await this.conectar(equipamentoId);
    }

    const inicio = Date.now();
    const tx = await protocol.write(buffer, { operacao: 'laboratorio_tx' });
    let rx = null;
    let erro = null;

    try {
      rx = await protocol.read({ timeout: 3000, operacao: 'laboratorio_rx' });
    } catch (err) {
      erro = err.message;
    }

    return {
      sucesso: !erro,
      enviado: frameStudio.visualizarBytes(buffer),
      resposta: rx?.dados ? frameStudio.visualizarBytes(rx.dados) : null,
      tempo_ms: Date.now() - inicio,
      erro
    };
  }

  /**
   * @param {Object} [filtros]
   * @returns {Object[]}
   */
  listarPacotes(filtros = {}) {
    return packetInspector.listar(filtros);
  }

  /**
   * @param {string|number|null} chave
   * @returns {Object[]}
   */
  listarPacotesGlobal(chave = null) {
    return packetInspector.listarHistoricoGlobal(chave);
  }

  /**
   * @param {string|number|null} chave
   */
  limparPacotes(chave = null) {
    packetInspector.limpar(chave);
  }

  iniciarCaptura(meta = {}) {
    return captureManager.iniciarCaptura(meta);
  }

  pararCaptura() {
    return captureManager.pararCaptura();
  }

  /**
   * @param {Object} [sessao]
   * @param {string} [nome]
   * @returns {Promise<Object>}
   */
  async salvarCaptura(sessao, nome) {
    const dados = sessao || captureManager.pararCaptura().sessao;
    if (!dados?.pacotes?.length && captureManager.obterSessaoAtual().pacotes.length) {
      dados.pacotes = captureManager.obterSessaoAtual().pacotes;
    }
    return captureManager.exportar(dados, nome);
  }

  listarCapturas() {
    return captureManager.listarCapturas();
  }

  abrirCaptura(id) {
    return captureManager.abrirCaptura(id);
  }

  /**
   * Abre captura em JSON/HEX/TXT/BIN (Sprint 13 — engenharia reversa).
   * @param {string} idOuCaminho
   * @returns {Object}
   */
  abrirCapturaMultiFormato(idOuCaminho) {
    // eslint-disable-next-line global-require
    const captureImporter = require('../engenharia-reversa/CaptureImporter');
    const fs = require('fs');
    if (fs.existsSync(idOuCaminho)) {
      return captureImporter.importar(idOuCaminho).toJSON();
    }
    return captureImporter.abrirPorId(idOuCaminho).toJSON();
  }

  /**
   * @param {number|string} equipamentoId
   * @param {number} indice
   * @param {string} capturaId
   * @returns {Promise<Object>}
   */
  async replay(equipamentoId, indice, capturaId) {
    const captura = captureManager.abrirCaptura(capturaId);
    const protocol = await this._obterProtocolo(equipamentoId);
    if (!protocol.conectado) {
      await this.conectar(equipamentoId);
    }
    return replayManager.replayDaCaptura(captura, indice, protocol);
  }

  /**
   * @param {string} capturaIdA
   * @param {string} capturaIdB
   * @returns {Object}
   */
  compararCapturas(capturaIdA, capturaIdB) {
    const a = captureManager.abrirCaptura(capturaIdA);
    const b = captureManager.abrirCaptura(capturaIdB);
    return packetComparator.compararCapturas(a, b);
  }

  /**
   * @param {string} hexA
   * @param {string} hexB
   * @returns {Object}
   */
  compararHex(hexA, hexB) {
    const bufA = frameStudio.hexParaAscii(hexA).buffer;
    const bufB = frameStudio.hexParaAscii(hexB).buffer;
    return packetComparator.compararBuffers(bufA, bufB);
  }

  /**
   * @param {Object} sessao
   * @param {string} [nome]
   * @returns {Promise<Object>}
   */
  async exportar(sessao, nome) {
    return captureManager.exportar(sessao, nome);
  }

  /**
   * Utilitários expostos para API/UI.
   */
  get frameStudio() { return frameStudio; }
  get packetInspector() { return packetInspector; }
  get captureManager() { return captureManager; }
  get replayManager() { return replayManager; }
  get packetComparator() { return packetComparator; }
  get diagnostico() { return diagnosticoEquipamentos; }
}

const laboratorioEquipamentos = new LaboratorioEquipamentos();

module.exports = laboratorioEquipamentos;
module.exports.LaboratorioEquipamentos = LaboratorioEquipamentos;
