/**
 * ProtocolCaptureService — Captura TCP integrada ao PacketLogger (Sprint 13).
 *
 * @class ProtocolCaptureService
 */

const packetLogger = require('../communication/PacketLogger');
const CaptureSession = require('./CaptureSession');
const frameAnalyzer = require('./FrameAnalyzer');
const protocolDocumentation = require('./ProtocolDocumentation');
const captureExporter = require('./CaptureExporter');
const captureImporter = require('./CaptureImporter');

class ProtocolCaptureService {
  constructor() {
    /** @type {CaptureSession|null} */
    this._sessaoAtual = null;
    /** @type {Function|null} */
    this._unsubscribe = null;
    this._inicializarHook();
  }

  /**
   * @private
   */
  _inicializarHook() {
    if (typeof packetLogger.adicionarListener === 'function') {
      this._unsubscribe = packetLogger.adicionarListener((entry) => this._onPacote(entry));
    }
  }

  /**
   * @param {Object} entry
   * @private
   */
  _onPacote(entry) {
    if (!this._sessaoAtual) return;

    const direcao = String(entry.direcao || 'TX').toUpperCase();
    if (direcao === 'TX') {
      this.registrarTX(entry);
    } else {
      this.registrarRX(entry);
    }
  }

  /**
   * @param {Object} entry
   * @returns {Object}
   * @private
   */
  _normalizarPacote(entry) {
    const buf = entry.buffer
      || (entry.hex ? Buffer.from(String(entry.hex).replace(/\s+/g, ''), 'hex') : Buffer.alloc(0));
    const analise = frameAnalyzer.analisarFrame(buf);
    const categoria = protocolDocumentation.classificarPacote(entry, analise);

    return {
      timestamp: entry.timestamp || new Date().toISOString(),
      direcao: String(entry.direcao || 'TX').toUpperCase(),
      tamanho: entry.tamanho || buf.length,
      bytes: entry.tamanho || buf.length,
      hex: entry.hex || analise.hex,
      ascii: entry.ascii || analise.ascii,
      ip: entry.host || this._sessaoAtual?.ip || null,
      host: entry.host || null,
      porta: entry.porta ?? this._sessaoAtual?.porta ?? null,
      socket: entry.chave || this._sessaoAtual?.socket || null,
      chave: entry.chave || null,
      driver: entry.driver || this._sessaoAtual?.driver || null,
      equipamento_id: entry.equipamento_id ?? this._sessaoAtual?.equipamento_id ?? null,
      comando: entry.comando || null,
      operacao: entry.operacao || null,
      ack: entry.ack === true,
      nak: entry.nak === true,
      timeout: entry.timeout === true,
      buffer_hex: buf.toString('hex'),
      analise,
      categoria
    };
  }

  /**
   * @param {Object} [meta]
   * @returns {Object}
   */
  iniciarCaptura(meta = {}) {
    if (this._sessaoAtual) {
      throw new Error('Captura já em andamento. Pare a sessão atual primeiro.');
    }
    this._sessaoAtual = new CaptureSession(meta);
    return {
      capturando: true,
      sessao: this._sessaoAtual.toJSON()
    };
  }

  /**
   * @returns {Object}
   */
  pararCaptura() {
    if (!this._sessaoAtual) {
      return { capturando: false, sessao: null };
    }
    const json = this._sessaoAtual.finalizar();
    const sessao = { ...json };
    this._sessaoAtual = null;
    return { capturando: false, sessao };
  }

  /**
   * @param {Object} entry
   * @returns {Object}
   */
  registrarTX(entry) {
    const pacote = this._normalizarPacote({ ...entry, direcao: 'TX' });
    if (this._sessaoAtual) this._sessaoAtual.adicionarPacote(pacote);
    return pacote;
  }

  /**
   * @param {Object} entry
   * @returns {Object}
   */
  registrarRX(entry) {
    const pacote = this._normalizarPacote({ ...entry, direcao: 'RX' });
    if (this._sessaoAtual) this._sessaoAtual.adicionarPacote(pacote);
    return pacote;
  }

  /**
   * @param {Object} entry — entrada bruta do PacketLogger
   * @returns {Object}
   */
  registrarPacote(entry) {
    const dir = String(entry.direcao || 'TX').toUpperCase();
    return dir === 'RX' ? this.registrarRX(entry) : this.registrarTX(entry);
  }

  estaCapturando() {
    return Boolean(this._sessaoAtual);
  }

  obterSessaoAtual() {
    if (!this._sessaoAtual) return null;
    return this._sessaoAtual.toJSON();
  }

  /**
   * @param {Object} [sessao]
   * @param {string} [nome]
   * @returns {Object}
   */
  exportar(sessao, nome) {
    const dados = sessao || this.pararCaptura().sessao;
    if (!dados) throw new Error('Nenhuma sessão para exportar');
    return captureExporter.exportar(dados, nome);
  }

  /**
   * @param {string} caminhoOuId
   * @returns {Object}
   */
  importar(caminhoOuId) {
    const fs = require('fs');
    if (fs.existsSync(caminhoOuId)) {
      return captureImporter.importar(caminhoOuId).toJSON();
    }
    return captureImporter.abrirPorId(caminhoOuId).toJSON();
  }

  listarCapturas() {
    return captureImporter.listarCapturas();
  }

  /**
   * @param {string} id
   * @returns {Object}
   */
  abrirCaptura(id) {
    return captureImporter.abrirPorId(id).toJSON();
  }

  /**
   * @param {Object|Object[]} sessoes
   * @returns {Object}
   */
  atualizarDocumentacao(sessoes) {
    const lista = sessoes || (this.obterSessaoAtual() ? [this.obterSessaoAtual()] : []);
    return protocolDocumentation.atualizarDocumento(lista);
  }
}

const protocolCaptureService = new ProtocolCaptureService();

module.exports = protocolCaptureService;
module.exports.ProtocolCaptureService = ProtocolCaptureService;
