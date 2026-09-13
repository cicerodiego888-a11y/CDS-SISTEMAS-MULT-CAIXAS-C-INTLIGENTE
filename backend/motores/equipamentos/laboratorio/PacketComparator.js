/**
 * PacketComparator — Comparação de capturas e buffers.
 *
 * @class PacketComparator
 */

const HexViewer = require('../communication/HexViewer');

let _frameAnalyzer = null;
let _protocolDocumentation = null;

function _analyzer() {
  if (!_frameAnalyzer) {
    // eslint-disable-next-line global-require
    _frameAnalyzer = require('../engenharia-reversa/FrameAnalyzer');
  }
  return _frameAnalyzer;
}

function _documentation() {
  if (!_protocolDocumentation) {
    // eslint-disable-next-line global-require
    _protocolDocumentation = require('../engenharia-reversa/ProtocolDocumentation');
  }
  return _protocolDocumentation;
}

class PacketComparator {
  /**
   * @param {Buffer|string} a
   * @param {Buffer|string} b
   * @returns {Object}
   */
  compararBuffers(a, b) {
    const bufA = Buffer.isBuffer(a) ? a : Buffer.from(String(a || ''), 'hex');
    const bufB = Buffer.isBuffer(b) ? b : Buffer.from(String(b || ''), 'hex');

    const tamanhoA = bufA.length;
    const tamanhoB = bufB.length;
    const maxLen = Math.max(tamanhoA, tamanhoB);
    const bytesAlterados = [];
    const inseridos = [];
    const removidos = [];

    for (let i = 0; i < maxLen; i += 1) {
      const byteA = i < tamanhoA ? bufA[i] : null;
      const byteB = i < tamanhoB ? bufB[i] : null;

      if (byteA === null && byteB !== null) {
        inseridos.push({ offset: i, byte: byteB, hex: byteB.toString(16).padStart(2, '0').toUpperCase() });
      } else if (byteA !== null && byteB === null) {
        removidos.push({ offset: i, byte: byteA, hex: byteA.toString(16).padStart(2, '0').toUpperCase() });
      } else if (byteA !== byteB) {
        bytesAlterados.push({
          offset: i,
          de: byteA,
          para: byteB,
          hex_de: byteA.toString(16).padStart(2, '0').toUpperCase(),
          hex_para: byteB.toString(16).padStart(2, '0').toUpperCase()
        });
      }
    }

    const identicos = bytesAlterados.length === 0 && inseridos.length === 0 && removidos.length === 0;

    return {
      identicos,
      tamanho_a: tamanhoA,
      tamanho_b: tamanhoB,
      diferenca_tamanho: tamanhoB - tamanhoA,
      bytes_alterados: bytesAlterados,
      bytes_inseridos: inseridos,
      bytes_removidos: removidos,
      total_diferencas: bytesAlterados.length + inseridos.length + removidos.length,
      checksum_a: this._checksumSimples(bufA),
      checksum_b: this._checksumSimples(bufB),
      hex_a: HexViewer.format(bufA).hex,
      hex_b: HexViewer.format(bufB).hex
    };
  }

  /**
   * Compara duas capturas (arrays de pacotes).
   * @param {Object} capturaA
   * @param {Object} capturaB
   * @returns {Object}
   */
  compararCapturas(capturaA, capturaB) {
    const pacotesA = capturaA?.pacotes || [];
    const pacotesB = capturaB?.pacotes || [];
    const comparacoes = [];
    const max = Math.max(pacotesA.length, pacotesB.length);

    for (let i = 0; i < max; i += 1) {
      const pA = pacotesA[i];
      const pB = pacotesB[i];
      if (!pA || !pB) {
        comparacoes.push({
          indice: i,
          tipo: !pA ? 'ausente_em_a' : 'ausente_em_b',
          pacote_a: pA || null,
          pacote_b: pB || null
        });
        continue;
      }

      const bufA = pA.buffer_hex
        ? Buffer.from(pA.buffer_hex, 'hex')
        : Buffer.from(String(pA.hex || '').replace(/\s+/g, ''), 'hex');
      const bufB = pB.buffer_hex
        ? Buffer.from(pB.buffer_hex, 'hex')
        : Buffer.from(String(pB.hex || '').replace(/\s+/g, ''), 'hex');

      comparacoes.push({
        indice: i,
        tipo: 'comparacao',
        direcao_a: pA.direcao,
        direcao_b: pB.direcao,
        diff: this.compararBuffers(bufA, bufB)
      });
    }

    const diferentes = comparacoes.filter((c) => c.tipo !== 'comparacao' || !c.diff?.identicos);

    return {
      total_a: pacotesA.length,
      total_b: pacotesB.length,
      comparacoes,
      resumo: {
        pacotes_comparados: comparacoes.filter((c) => c.tipo === 'comparacao').length,
        pacotes_diferentes: diferentes.length,
        identicos: diferentes.length === 0
      }
    };
  }

  /**
   * Classifica pacote por heurística (Sprint 13).
   * @param {Object} pacote
   * @returns {string}
   */
  classificarPacote(pacote) {
    const buf = pacote.buffer_hex
      ? Buffer.from(pacote.buffer_hex, 'hex')
      : Buffer.from(String(pacote.hex || '').replace(/\s+/g, ''), 'hex');
    const analise = pacote.analise || _analyzer().analisarFrame(buf);
    return pacote.categoria || _documentation().classificarPacote(pacote, analise, pacote.observacao);
  }

  /**
   * Filtra pacotes de uma captura por categoria.
   * @param {Object} captura
   * @param {string} categoria
   * @returns {Object[]}
   */
  filtrarPorCategoria(captura, categoria) {
    const cat = String(categoria || '').toLowerCase();
    return (captura?.pacotes || []).filter((p) => this.classificarPacote(p) === cat);
  }

  /**
   * @param {Object} capturaA
   * @param {Object} capturaB
   * @param {string} categoria
   * @returns {Object}
   */
  compararCapturasPorCategoria(capturaA, capturaB, categoria) {
    const listaA = this.filtrarPorCategoria(capturaA, categoria);
    const listaB = this.filtrarPorCategoria(capturaB, categoria);
    const comparacoes = [];
    const max = Math.max(listaA.length, listaB.length);

    for (let i = 0; i < max; i += 1) {
      const pA = listaA[i];
      const pB = listaB[i];
      if (!pA || !pB) {
        comparacoes.push({
          indice: i,
          categoria,
          tipo: !pA ? 'ausente_em_a' : 'ausente_em_b',
          pacote_a: pA || null,
          pacote_b: pB || null
        });
        continue;
      }

      const bufA = Buffer.from(pA.buffer_hex || String(pA.hex || '').replace(/\s+/g, ''), 'hex');
      const bufB = Buffer.from(pB.buffer_hex || String(pB.hex || '').replace(/\s+/g, ''), 'hex');

      comparacoes.push({
        indice: i,
        categoria,
        tipo: 'comparacao_byte_a_byte',
        diff: this.compararBuffers(bufA, bufB)
      });
    }

    const diferentes = comparacoes.filter((c) => c.tipo !== 'comparacao_byte_a_byte' || !c.diff?.identicos);

    return {
      categoria,
      total_a: listaA.length,
      total_b: listaB.length,
      comparacoes,
      resumo: {
        pares_comparados: comparacoes.filter((c) => c.tipo === 'comparacao_byte_a_byte').length,
        diferentes: diferentes.length,
        identicos: diferentes.length === 0
      }
    };
  }

  compararHandshake(capturaA, capturaB) {
    return this.compararCapturasPorCategoria(capturaA, capturaB, 'handshake');
  }

  compararProduto(capturaA, capturaB) {
    return this.compararCapturasPorCategoria(capturaA, capturaB, 'produto');
  }

  compararPromocao(capturaA, capturaB) {
    return this.compararCapturasPorCategoria(capturaA, capturaB, 'promocao');
  }

  compararDepartamento(capturaA, capturaB) {
    return this.compararCapturasPorCategoria(capturaA, capturaB, 'departamento');
  }

  /**
   * Checksum simples (soma mod 256) — placeholder até CRC oficial.
   * @param {Buffer} buf
   * @returns {number|null}
   * @private
   */
  _checksumSimples(buf) {
    if (!buf || !buf.length) return null;
    let sum = 0;
    for (const byte of buf) {
      sum = (sum + byte) % 256;
    }
    return sum;
  }
}

const packetComparator = new PacketComparator();

module.exports = packetComparator;
module.exports.PacketComparator = PacketComparator;
