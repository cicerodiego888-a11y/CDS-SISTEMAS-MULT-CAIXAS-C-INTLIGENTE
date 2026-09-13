/**
 * ToledoPrix4Parser — Interpretação de respostas da balança Toledo Prix 4 Uno.
 *
 * Sprint 11A: infraestrutura com respostas simuladas (formato temporário).
 * Sprint 11B: substituir parsing pelos frames oficiais 90AX.
 *
 * @class ToledoPrix4Parser
 */

const frameBuilder = require('./ToledoPrix4FrameBuilder');
const { RESPOSTA } = frameBuilder;

/**
 * @param {Buffer|string} dados
 * @returns {Buffer}
 * @private
 */
function _paraBuffer(dados) {
  if (!dados) return Buffer.alloc(0);
  return Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));
}

/**
 * @param {Buffer} buf
 * @returns {string|null}
 * @private
 */
function _extrairPayloadTexto(buf) {
  const sepIdx = buf.indexOf(frameBuilder.SEP);
  if (sepIdx < 0) return null;
  const inicio = sepIdx + 1;
  const fim = buf.lastIndexOf(frameBuilder.ETX);
  if (fim <= inicio) return '';
  return buf.slice(inicio, fim).toString('utf8');
}

/**
 * @param {string} texto
 * @returns {*}
 * @private
 */
function _parseJsonSeguro(texto) {
  if (!texto || !String(texto).trim()) return null;
  try {
    return JSON.parse(texto);
  } catch (_) {
    return texto;
  }
}

class ToledoPrix4Parser {
  /**
   * Interpreta frame genérico (formato temporário Sprint 11A).
   * @param {Buffer|string} dadosBrutos
   * @returns {Object|null}
   */
  parseFrame(dadosBrutos) {
    const buf = _paraBuffer(dadosBrutos);
    if (!buf.length) return null;

    if (buf[0] !== frameBuilder.STX || buf[buf.length - 1] !== frameBuilder.ETX) {
      return null;
    }

    const comando = buf.slice(1, 3).toString('ascii').toUpperCase();
    const payloadTexto = _extrairPayloadTexto(buf);
    const payload = _parseJsonSeguro(payloadTexto);

    const base = {
      comando,
      payload,
      bruto: buf,
      simulado: true,
      formato: 'temporario-11A'
    };

    if (comando === RESPOSTA.ACK) {
      return { ...base, tipo: 'ACK', sucesso: true };
    }
    if (comando === RESPOSTA.NAK) {
      return { ...base, tipo: 'NAK', sucesso: false };
    }
    if (comando === RESPOSTA.STATUS) {
      return { ...base, tipo: 'STATUS', sucesso: true };
    }
    if (comando === RESPOSTA.PESO) {
      return { ...base, tipo: 'PESO', sucesso: true };
    }

    return { ...base, tipo: 'FRAME', sucesso: true };
  }

  /**
   * @param {Buffer|string} dadosBrutos
   * @returns {Object|null}
   */
  parseACK(dadosBrutos) {
    const frame = this.parseFrame(dadosBrutos);
    if (!frame || frame.tipo !== 'ACK') return null;
    return {
      sucesso: true,
      ack: true,
      comando: frame.comando,
      payload: frame.payload,
      simulado: true,
      bruto: frame.bruto
    };
  }

  /**
   * @param {Buffer|string} dadosBrutos
   * @returns {Object|null}
   */
  parseNAK(dadosBrutos) {
    const frame = this.parseFrame(dadosBrutos);
    if (!frame || frame.tipo !== 'NAK') return null;
    const mensagem = typeof frame.payload === 'object'
      ? frame.payload?.mensagem || 'NAK'
      : String(frame.payload || 'NAK');
    return {
      sucesso: false,
      nak: true,
      mensagem,
      payload: frame.payload,
      simulado: true,
      bruto: frame.bruto
    };
  }

  /**
   * @param {Buffer|string} dadosBrutos
   * @returns {Object|null}
   */
  parseStatus(dadosBrutos) {
    const frame = this.parseFrame(dadosBrutos);
    if (!frame) return null;

    if (frame.tipo === 'STATUS') {
      return {
        online: frame.payload?.online !== false,
        firmware: frame.payload?.firmware || '90AX-sim',
        dados: frame.payload || {},
        simulado: true,
        bruto: frame.bruto
      };
    }

    if (frame.tipo === 'ACK' && frame.payload) {
      return {
        online: true,
        firmware: frame.payload?.firmware || '90AX-sim',
        dados: frame.payload,
        simulado: true,
        bruto: frame.bruto
      };
    }

    return null;
  }

  /**
   * @param {Buffer|string} dadosBrutos
   * @returns {Object}
   */
  parsePeso(dadosBrutos) {
    const frame = dadosBrutos ? this.parseFrame(dadosBrutos) : null;

    if (frame?.tipo === 'PESO') {
      return {
        valor: frame.payload?.valor ?? null,
        unidade: frame.payload?.unidade || 'kg',
        estavel: Boolean(frame.payload?.estavel),
        simulado: true,
        bruto: frame.bruto
      };
    }

    if (frame?.tipo === 'ACK' && frame.payload?.valor != null) {
      return {
        valor: frame.payload.valor,
        unidade: frame.payload.unidade || 'kg',
        estavel: Boolean(frame.payload.estavel),
        simulado: true,
        bruto: frame.bruto
      };
    }

    return {
      valor: null,
      unidade: 'kg',
      estavel: false,
      simulado: true,
      bruto: dadosBrutos || null
    };
  }

  /**
   * @param {Buffer|string} dadosBrutos
   * @param {string} [mensagem]
   * @returns {Object}
   */
  parseErro(dadosBrutos, mensagem) {
    const nak = this.parseNAK(dadosBrutos);
    if (nak) {
      return {
        tipo: 'NAK',
        sucesso: false,
        mensagem: nak.mensagem,
        simulado: true,
        bruto: nak.bruto
      };
    }

    const frame = dadosBrutos ? this.parseFrame(dadosBrutos) : null;
    if (frame && frame.tipo === 'FRAME' && !frame.sucesso) {
      return {
        tipo: 'ERRO',
        sucesso: false,
        mensagem: mensagem || 'erro de protocolo',
        simulado: true,
        bruto: frame.bruto
      };
    }

    return {
      tipo: mensagem ? 'ERRO' : 'TIMEOUT',
      sucesso: false,
      mensagem: mensagem || 'timeout ou resposta inválida',
      simulado: true,
      bruto: dadosBrutos || null
    };
  }

  // ─── Aliases legados (compatibilidade Sprint anterior) ─────────

  parseResposta(dadosBrutos) { return this.parseFrame(dadosBrutos); }
  parseHandshake(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parsePing(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parseProdutoResposta(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parsePromocaoResposta(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parseDepartamentoResposta(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parseEtiquetaResposta(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parseLoteResposta(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parseAck(dadosBrutos) { return this.parseACK(dadosBrutos); }
  parseNak(dadosBrutos) { return this.parseNAK(dadosBrutos); }
}

module.exports = ToledoPrix4Parser;
