/**
 * Sprint 14.2 — ProtocolDetector
 * Infraestrutura de detecção de protocolos. Sem parser completo.
 *
 * Futuro: TOLEDO_90AX, TOLEDO_ETH, FILIZOLA, URANO, ELGIN
 */

'use strict';

/** Protocolos previstos (Sprint 14.3+). */
const PROTOCOLOS_FUTUROS = Object.freeze([
  'TOLEDO_90AX',
  'TOLEDO_ETH',
  'FILIZOLA',
  'URANO',
  'ELGIN'
]);

/**
 * Assinaturas passivas (apenas leitura de banner — nunca envia comandos).
 * V1: registro preparado; padrões reais entram quando houver captura segura.
 */
const ASSINATURAS = [
  {
    protocol: 'TOLEDO_ETH',
    confidence: 98,
    // Marcador controlado (testes / futuro banner). Não é comando de balança.
    test: (texto, hex) => /__FP_TOLEDO_ETH__/i.test(texto) || /544f4c45444f/i.test(hex)
  },
  {
    protocol: 'TOLEDO_90AX',
    confidence: 95,
    test: (texto) => /__FP_TOLEDO_90AX__/i.test(texto)
  },
  {
    protocol: 'FILIZOLA',
    confidence: 90,
    test: (texto) => /__FP_FILIZOLA__/i.test(texto)
  },
  {
    protocol: 'URANO',
    confidence: 90,
    test: (texto) => /__FP_URANO__/i.test(texto)
  },
  {
    protocol: 'ELGIN',
    confidence: 90,
    test: (texto) => /__FP_ELGIN__/i.test(texto)
  }
];

class ProtocolDetector {
  constructor({ assinaturas = ASSINATURAS } = {}) {
    this.assinaturas = Array.isArray(assinaturas) ? assinaturas : ASSINATURAS;
  }

  /**
   * @param {Buffer|string|null|object} response
   * @returns {{ protocol: string|null, confidence: number, meta?: object }}
   */
  detect(response) {
    if (response == null) {
      return { protocol: null, confidence: 0 };
    }

    let buffer = null;
    if (Buffer.isBuffer(response)) {
      buffer = response;
    } else if (typeof response === 'string') {
      buffer = Buffer.from(response, 'utf8');
    } else if (response && Buffer.isBuffer(response.buffer)) {
      buffer = response.buffer;
    } else if (response && typeof response.raw === 'string') {
      buffer = Buffer.from(response.raw, 'utf8');
    }

    if (!buffer || buffer.length === 0) {
      return { protocol: null, confidence: 0, meta: { bytes: 0 } };
    }

    const texto = buffer.toString('utf8');
    const hex = buffer.toString('hex');

    for (const sig of this.assinaturas) {
      try {
        if (typeof sig.test === 'function' && sig.test(texto, hex, buffer)) {
          return {
            protocol: sig.protocol,
            confidence: Number(sig.confidence) || 0,
            meta: { bytes: buffer.length, matched: sig.protocol }
          };
        }
      } catch (_) { /* assinatura inválida — ignora */ }
    }

    return {
      protocol: null,
      confidence: 0,
      meta: { bytes: buffer.length, matched: null }
    };
  }

  listarProtocolosFuturos() {
    return [...PROTOCOLOS_FUTUROS];
  }
}

module.exports = ProtocolDetector;
module.exports.ProtocolDetector = ProtocolDetector;
module.exports.PROTOCOLOS_FUTUROS = PROTOCOLOS_FUTUROS;
module.exports.ASSINATURAS = ASSINATURAS;
