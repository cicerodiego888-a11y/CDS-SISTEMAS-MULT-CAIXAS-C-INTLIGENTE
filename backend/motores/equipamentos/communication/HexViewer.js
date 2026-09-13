/**
 * HexViewer — Visualização de pacotes em HEX e ASCII (Sprint 10).
 *
 * @module communication/HexViewer
 */

class HexViewer {
  /**
   * Formata buffer para exibição/diagnóstico.
   * @param {Buffer|string} buffer
   * @returns {{ hex: string, ascii: string, tamanho: number }}
   */
  static format(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''));
    const hex = buf.length
      ? buf.toString('hex').toUpperCase().match(/.{1,2}/g).join(' ')
      : '';
    const ascii = [...buf]
      .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
      .join('');

    return {
      hex,
      ascii,
      tamanho: buf.length
    };
  }

  /**
   * Formata linhas agrupadas (16 bytes por linha).
   * @param {Buffer|string} buffer
   * @returns {Object[]}
   */
  static formatLinhas(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''));
    const linhas = [];

    for (let offset = 0; offset < buf.length; offset += 16) {
      const chunk = buf.subarray(offset, offset + 16);
      const visual = HexViewer.format(chunk);
      linhas.push({
        offset,
        hex: visual.hex,
        ascii: visual.ascii,
        tamanho: visual.tamanho
      });
    }

    return linhas;
  }
}

module.exports = HexViewer;
