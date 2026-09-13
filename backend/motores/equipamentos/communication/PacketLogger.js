/**
 * PacketLogger — Registro de bytes TX/RX em HEX (Sprint 10).
 *
 * @class PacketLogger
 */

const HexViewer = require('./HexViewer');
const packetHistory = require('./PacketHistory');
const loggerService = require('../services/LoggerService');

class PacketLogger {
  constructor() {
    /** @type {Array<Function>} */
    this._listeners = [];
  }

  /**
   * Registra listener para integração com Laboratório (Sprint 12).
   * @param {Function} fn - (entry) => void
   * @returns {Function} unsubscribe
   */
  adicionarListener(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((f) => f !== fn);
    };
  }

  /**
   * @param {Object} entry
   * @private
   */
  _notificarListeners(entry) {
    for (const fn of this._listeners) {
      try {
        fn(entry);
      } catch (_) {
        // não interrompe logging
      }
    }
  }

  /**
   * Registra pacote enviado ou recebido.
   * @param {'TX'|'RX'|string} direcao
   * @param {Buffer|string} buffer
   * @param {Object} [meta]
   * @returns {Object}
   */
  log(direcao, buffer, meta = {}) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''));
    const visual = HexViewer.format(buf);
    const direcaoNorm = String(direcao || 'TX').toUpperCase();
    const ip = meta.ip ?? meta.host ?? null;
    const tentativa = meta.tentativa ?? meta.retry ?? null;
    const bytesCount = visual.tamanho;

    const entry = {
      timestamp: meta.timestamp ?? new Date().toISOString(),
      direcao: direcaoNorm,
      hex: visual.hex,
      ascii: visual.ascii,
      tamanho: bytesCount,
      equipamento_id: meta.equipamento_id ?? null,
      chave: meta.chave ?? null,
      host: ip,
      ip,
      porta: meta.porta ?? null,
      driver: meta.driver ?? null,
      firmware: meta.firmware ?? null,
      comando: meta.comando ?? null,
      operacao: meta.operacao ?? null,
      resultado: meta.resultado ?? null,
      tempo_ms: meta.tempo_ms ?? meta.tempo_operacao_ms ?? null,
      bytes_tx: meta.bytes_tx ?? (direcaoNorm === 'TX' ? bytesCount : null),
      bytes_rx: meta.bytes_rx ?? (direcaoNorm === 'RX' ? bytesCount : null),
      tentativa,
      ack: meta.ack === true,
      nak: meta.nak === true,
      timeout: meta.timeout === true,
      retry: tentativa,
      buffer: buf
    };

    packetHistory.adicionar(entry);
    this._notificarListeners(entry);

    loggerService.debug(`Pacote ${entry.direcao} (${entry.tamanho} bytes)`, {
      operacao: `pacote.${entry.direcao.toLowerCase()}`,
      equipamento_id: entry.equipamento_id,
      contexto: {
        hex: entry.hex,
        ascii: entry.ascii,
        tamanho: entry.tamanho,
        chave: entry.chave,
        ip: entry.ip,
        porta: entry.porta,
        driver: entry.driver,
        firmware: entry.firmware,
        comando: entry.comando,
        resultado: entry.resultado,
        tempo_ms: entry.tempo_ms,
        bytes_tx: entry.bytes_tx,
        bytes_rx: entry.bytes_rx,
        tentativa: entry.tentativa,
        ack: entry.ack,
        nak: entry.nak,
        timeout: entry.timeout,
        retry: entry.retry,
        timestamp: entry.timestamp
      }
    }).catch(() => {});

    return entry;
  }

  /**
   * @param {string|number|null} chave
   * @param {Object} [opcoes]
   * @returns {Object[]}
   */
  listar(chave = null, opcoes = {}) {
    return packetHistory.listar(chave, opcoes);
  }

  limpar(chave = null) {
    packetHistory.limpar(chave);
  }

  reiniciar() {
    packetHistory.reiniciar();
  }
}

const packetLogger = new PacketLogger();

module.exports = packetLogger;
module.exports.PacketLogger = PacketLogger;
