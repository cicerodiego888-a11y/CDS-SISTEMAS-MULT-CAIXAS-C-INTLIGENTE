/**
 * FrameAnalyzer — Detecção heurística de padrões em frames (Sprint 13).
 *
 * Apenas marca padrões observáveis. Nunca assume protocolo oficial.
 *
 * @class FrameAnalyzer
 */

const HexViewer = require('../communication/HexViewer');

/** Bytes comuns em protocolos seriais — apenas referência heurística */
const BYTES_REFERENCIA = {
  STX_CANDIDATOS: [0x02, 0x01, 0x05],
  ETX_CANDIDATOS: [0x03, 0x04],
  ACK: 0x06,
  NAK: 0x15,
  SEP_CANDIDATOS: [0x1c, 0x7c, 0x3b]
};

class FrameAnalyzer {
  /**
   * @param {Buffer|string} buffer
   * @returns {Object}
   */
  analisarFrame(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || '').replace(/\s+/g, ''), 'hex');
    const visual = HexViewer.format(buf);

    const padroes = {
      stx: this.identificarSTX(buf),
      etx: this.identificarETX(buf),
      ack: this.identificarACK(buf),
      nak: this.identificarNAK(buf),
      ascii: this.identificarASCII(buf),
      binario: this.identificarBINARIO(buf),
      crc: this.identificarCRC(buf),
      checksum: this.identificarCHECKSUM(buf)
    };

    const campos = this.identificarCampos(buf, padroes);
    const payload = this.identificarPayload(buf, padroes, campos);

    return {
      tamanho: buf.length,
      hex: visual.hex,
      ascii: visual.ascii,
      padroes,
      campos,
      payload,
      nota: 'Análise heurística — não constitui especificação de protocolo'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarSTX(buf) {
    if (!buf.length) return { detectado: false };
    const byte = buf[0];
    const candidato = BYTES_REFERENCIA.STX_CANDIDATOS.includes(byte);
    return {
      detectado: candidato,
      offset: 0,
      valor: byte,
      hex: byte.toString(16).padStart(2, '0').toUpperCase(),
      confianca: candidato ? 'media' : 'baixa',
      nota: candidato ? 'Byte inicial compatível com STX comum' : 'Sem STX reconhecível no início'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarETX(buf) {
    if (!buf.length) return { detectado: false };
    const offset = buf.length - 1;
    const byte = buf[offset];
    const candidato = BYTES_REFERENCIA.ETX_CANDIDATOS.includes(byte);
    return {
      detectado: candidato,
      offset,
      valor: byte,
      hex: byte.toString(16).padStart(2, '0').toUpperCase(),
      confianca: candidato ? 'media' : 'baixa',
      nota: candidato ? 'Byte final compatível com ETX comum' : 'Sem ETX reconhecível no fim'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarACK(buf) {
    const offsets = [];
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] === BYTES_REFERENCIA.ACK) offsets.push(i);
    }
    const frameInteiro = buf.length === 1 && buf[0] === BYTES_REFERENCIA.ACK;
    return {
      detectado: offsets.length > 0,
      offsets,
      frame_inteiro_ack: frameInteiro,
      confianca: frameInteiro ? 'media' : (offsets.length ? 'baixa' : 'nenhuma'),
      nota: 'Padrão ACK (0x06) — hipótese apenas'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarNAK(buf) {
    const offsets = [];
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] === BYTES_REFERENCIA.NAK) offsets.push(i);
    }
    const frameInteiro = buf.length === 1 && buf[0] === BYTES_REFERENCIA.NAK;
    return {
      detectado: offsets.length > 0,
      offsets,
      frame_inteiro_nak: frameInteiro,
      confianca: frameInteiro ? 'media' : (offsets.length ? 'baixa' : 'nenhuma'),
      nota: 'Padrão NAK (0x15) — hipótese apenas'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarASCII(buf) {
    const segmentos = [];
    let inicio = null;

    for (let i = 0; i < buf.length; i += 1) {
      const b = buf[i];
      const imprimivel = b >= 0x20 && b <= 0x7e;
      if (imprimivel && inicio === null) inicio = i;
      if (!imprimivel && inicio !== null) {
        segmentos.push({
          offset: inicio,
          tamanho: i - inicio,
          texto: buf.slice(inicio, i).toString('ascii')
        });
        inicio = null;
      }
    }
    if (inicio !== null) {
      segmentos.push({
        offset: inicio,
        tamanho: buf.length - inicio,
        texto: buf.slice(inicio).toString('ascii')
      });
    }

    return {
      detectado: segmentos.length > 0,
      segmentos,
      confianca: segmentos.length ? 'media' : 'nenhuma',
      nota: 'Trechos ASCII imprimíveis (0x20–0x7E)'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarBINARIO(buf) {
    const segmentos = [];
    let inicio = null;

    for (let i = 0; i < buf.length; i += 1) {
      const b = buf[i];
      const binario = b < 0x20 || b > 0x7e;
      if (binario && inicio === null) inicio = i;
      if (!binario && inicio !== null) {
        segmentos.push({
          offset: inicio,
          tamanho: i - inicio,
          hex: buf.slice(inicio, i).toString('hex').toUpperCase()
        });
        inicio = null;
      }
    }
    if (inicio !== null) {
      segmentos.push({
        offset: inicio,
        tamanho: buf.length - inicio,
        hex: buf.slice(inicio).toString('hex').toUpperCase()
      });
    }

    return {
      detectado: segmentos.length > 0,
      segmentos,
      confianca: segmentos.length ? 'media' : 'nenhuma',
      nota: 'Trechos não imprimíveis'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarCRC(buf) {
    if (buf.length < 3) {
      return { detectado: false, nota: 'Frame curto demais para hipótese de CRC' };
    }

    const hipoteses = [];
    for (const tamanho of [1, 2]) {
      if (buf.length <= tamanho) continue;
      const dados = buf.slice(0, buf.length - tamanho);
      const possivel = buf.slice(buf.length - tamanho);
      hipoteses.push({
        tamanho_bytes: tamanho,
        offset: buf.length - tamanho,
        valor_hex: possivel.toString('hex').toUpperCase(),
        dados_hex: dados.toString('hex').toUpperCase(),
        confianca: 'baixa',
        nota: 'Possível campo CRC/checksum no final — não validado'
      });
    }

    return {
      detectado: hipoteses.length > 0,
      hipoteses,
      nota: 'Hipóteses de CRC — requer validação com capturas MGV7'
    };
  }

  /**
   * @param {Buffer} buf
   * @returns {Object}
   */
  identificarCHECKSUM(buf) {
    if (buf.length < 2) {
      return { detectado: false, nota: 'Frame curto demais para checksum' };
    }

    const ultimo = buf[buf.length - 1];
    const dados = buf.slice(0, buf.length - 1);
    let soma = 0;
    for (const b of dados) soma = (soma + b) % 256;
    const xor = dados.reduce((acc, b) => acc ^ b, 0);

    const hipoteses = [];
    if (soma === ultimo) {
      hipoteses.push({ algoritmo: 'soma_mod_256', valor_esperado: soma, confianca: 'baixa' });
    }
    if (xor === ultimo) {
      hipoteses.push({ algoritmo: 'xor', valor_esperado: xor, confianca: 'baixa' });
    }

    return {
      detectado: hipoteses.length > 0,
      byte_checksum_offset: buf.length - 1,
      byte_checksum: ultimo,
      hipoteses,
      nota: 'Checksum inferido — hipótese apenas'
    };
  }

  /**
   * @param {Buffer} buf
   * @param {Object} padroes
   * @returns {Object[]}
   */
  identificarCampos(buf, padroes = {}) {
    const campos = [];
    const stx = padroes.stx || this.identificarSTX(buf);
    const etx = padroes.etx || this.identificarETX(buf);

    if (stx.detectado) {
      campos.push({ tipo: 'possivel_stx', offset: 0, tamanho: 1, confianca: stx.confianca });
    }

    let corpoInicio = stx.detectado ? 1 : 0;
    let corpoFim = etx.detectado ? buf.length - 1 : buf.length;
    const corpo = buf.slice(corpoInicio, corpoFim);

    if (corpo.length >= 2) {
      const possivelComando = corpo.slice(0, 2).toString('ascii');
      if (/^[A-Z]{2}$/.test(possivelComando)) {
        campos.push({
          tipo: 'possivel_comando_ascii',
          offset: corpoInicio,
          tamanho: 2,
          valor: possivelComando,
          confianca: 'baixa',
          nota: 'Dois bytes ASCII maiúsculos após STX — hipótese'
        });
        corpoInicio += 2;
      }
    }

    for (let i = corpoInicio; i < corpoFim; i += 1) {
      if (BYTES_REFERENCIA.SEP_CANDIDATOS.includes(buf[i])) {
        campos.push({
          tipo: 'possivel_separador',
          offset: i,
          tamanho: 1,
          valor_hex: buf[i].toString(16).padStart(2, '0').toUpperCase(),
          confianca: 'baixa'
        });
      }
    }

    if (etx.detectado) {
      campos.push({
        tipo: 'possivel_etx',
        offset: buf.length - 1,
        tamanho: 1,
        confianca: etx.confianca
      });
    }

    return campos;
  }

  /**
   * @param {Buffer} buf
   * @param {Object} [padroes]
   * @param {Object[]} [campos]
   * @returns {Object}
   */
  identificarPayload(buf, padroes = {}, campos = []) {
    const stx = padroes.stx || this.identificarSTX(buf);
    const etx = padroes.etx || this.identificarETX(buf);
    const separadores = campos.filter((c) => c.tipo === 'possivel_separador');

    let inicio = stx.detectado ? 1 : 0;
    const comando = campos.find((c) => c.tipo === 'possivel_comando_ascii');
    if (comando) inicio = comando.offset + comando.tamanho;

    if (separadores.length) {
      const sep = separadores[0];
      inicio = sep.offset + sep.tamanho;
    }

    const fim = etx.detectado ? buf.length - 1 : buf.length;
    if (inicio >= fim) {
      return { detectado: false, nota: 'Payload não identificável' };
    }

    const slice = buf.slice(inicio, fim);
    const ascii = this.identificarASCII(slice);

    return {
      detectado: slice.length > 0,
      offset: inicio,
      tamanho: slice.length,
      hex: slice.toString('hex').toUpperCase(),
      ascii: ascii.segmentos?.[0]?.texto || null,
      confianca: 'baixa',
      nota: 'Região entre separadores/STX/ETX — hipótese de payload'
    };
  }
}

const frameAnalyzer = new FrameAnalyzer();

module.exports = frameAnalyzer;
module.exports.FrameAnalyzer = FrameAnalyzer;
module.exports.BYTES_REFERENCIA = BYTES_REFERENCIA;
