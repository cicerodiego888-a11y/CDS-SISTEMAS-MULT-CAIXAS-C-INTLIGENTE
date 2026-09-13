/**
 * FrameStudio — Montagem e visualização de frames para o Laboratório.
 *
 * Utiliza o FrameBuilder do driver correspondente (via frameBuilderMap).
 * Não depende de nenhum driver específico.
 *
 * @class FrameStudio
 */

const HexViewer = require('../communication/HexViewer');
const { resolverFrameBuilder } = require('./frameBuilderMap');

/** Comandos genéricos suportados pelo laboratório */
const COMANDOS_FRAME = {
  handshake: 'buildHandshake',
  ping: 'buildPing',
  status: 'buildStatus',
  produto: 'buildProduto',
  departamento: 'buildDepartamento',
  promocao: 'buildPromocao',
  remocao: 'buildRemocaoProduto',
  frame: 'buildFrame'
};

class FrameStudio {
  /**
   * @param {string} codigoDriver
   * @returns {Object|null}
   * @private
   */
  _builder(codigoDriver) {
    return resolverFrameBuilder(codigoDriver);
  }

  /**
   * @param {string} codigoDriver
   * @returns {boolean}
   */
  possuiFrameBuilder(codigoDriver) {
    return Boolean(this._builder(codigoDriver));
  }

  /**
   * Monta frame usando FrameBuilder do driver.
   * @param {string} codigoDriver
   * @param {string} tipoComando - handshake|ping|status|produto|...
   * @param {*} [payload]
   * @returns {{ buffer: Buffer, visual: Object, tamanho: number, comando: string }}
   */
  montarFrame(codigoDriver, tipoComando, payload) {
    const builder = this._builder(codigoDriver);
    if (!builder) {
      throw new Error(`FrameBuilder não disponível para driver: ${codigoDriver}`);
    }

    const metodo = COMANDOS_FRAME[String(tipoComando || '').toLowerCase()];
    let buffer;

    if (metodo === 'buildFrame') {
      const cmd = payload?.comando || payload?.cmd;
      const dados = payload?.dados ?? payload?.payload ?? payload;
      buffer = builder.buildFrame(cmd, dados);
    } else if (metodo && typeof builder[metodo] === 'function') {
      buffer = builder[metodo](payload);
    } else {
      throw new Error(`Comando de frame não suportado: ${tipoComando}`);
    }

    return this.visualizarBytes(buffer, { codigoDriver, comando: tipoComando });
  }

  /**
   * @param {Buffer|string} buffer
   * @param {Object} [meta]
   * @returns {Object}
   */
  visualizarBytes(buffer, meta = {}) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''));
    const visual = HexViewer.format(buf);
    const linhas = HexViewer.formatLinhas(buf);
    const offsets = linhas.map((l) => ({
      offset: l.offset,
      hex: l.hex,
      ascii: l.ascii,
      tamanho: l.tamanho
    }));

    return {
      buffer: buf,
      hex: visual.hex,
      ascii: visual.ascii,
      tamanho: visual.tamanho,
      offsets,
      meta
    };
  }

  /**
   * @param {string} texto
   * @returns {{ hex: string, buffer: Buffer }}
   */
  asciiParaHex(texto) {
    const buf = Buffer.from(String(texto || ''), 'utf8');
    return { hex: HexViewer.format(buf).hex, buffer: buf };
  }

  /**
   * @param {string} hex - espaços opcionais
   * @returns {{ ascii: string, buffer: Buffer }}
   */
  hexParaAscii(hex) {
    const limpo = String(hex || '').replace(/\s+/g, '');
    const buf = Buffer.from(limpo, 'hex');
    return { ascii: HexViewer.format(buf).ascii, buffer: buf };
  }

  /**
   * @param {Buffer|string} buffer
   * @returns {number}
   */
  calcularTamanho(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''));
    return buf.length;
  }

  /**
   * @param {*} payload
   * @returns {Object}
   */
  prepararPayload(payload) {
    if (payload === null || payload === undefined) return { vazio: true };
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload);
      } catch (_) {
        return { texto: payload };
      }
    }
    return payload;
  }

  /**
   * Lista comandos disponíveis para um driver.
   * @param {string} codigoDriver
   * @returns {string[]}
   */
  listarComandos(codigoDriver) {
    const builder = this._builder(codigoDriver);
    if (!builder) return [];
    return Object.keys(COMANDOS_FRAME).filter((k) => {
      const m = COMANDOS_FRAME[k];
      return m === 'buildFrame' || typeof builder[m] === 'function';
    });
  }
}

const frameStudio = new FrameStudio();

module.exports = frameStudio;
module.exports.FrameStudio = FrameStudio;
module.exports.COMANDOS_FRAME = COMANDOS_FRAME;
