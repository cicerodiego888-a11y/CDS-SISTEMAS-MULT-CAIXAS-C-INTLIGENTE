/**
 * CaptureExporter — Exportação multi-formato (Sprint 13).
 */

const fs = require('fs');
const path = require('path');
const wiresharkFormat = require('./WiresharkFormat');
const { diretorioCapturas } = require('./paths');

class CaptureExporter {
  /**
   * @param {Object} sessao
   * @param {string} [nomeArquivo]
   * @returns {Object}
   */
  exportar(sessao, nomeArquivo) {
    const dados = sessao?.pacotes ? sessao : { pacotes: [], ...sessao };
    const id = nomeArquivo || dados.id || `cap-er-${Date.now()}`;
    const dir = diretorioCapturas();
    const basePath = path.join(dir, id);

    const payload = {
      ...dados,
      exportado_em: new Date().toISOString(),
      formato: 'cds-engenharia-reversa-v1',
      pacotes: dados.pacotes || []
    };

    const jsonPath = `${basePath}.json`;
    const hexPath = `${basePath}.hex.txt`;
    const txtPath = `${basePath}.txt`;
    const binPath = `${basePath}.bin`;
    const csvPath = `${basePath}.csv`;
    const wirePath = `${basePath}.wireshark.txt`;

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

    const linhasHex = payload.pacotes.map((p, i) => {
      return `[${i + 1}] ${p.timestamp || ''} ${p.direcao || '?'} ${p.hex || ''}`;
    });
    fs.writeFileSync(hexPath, linhasHex.join('\n'), 'utf8');

    const linhasTxt = payload.pacotes.map((p, i) => {
      return `[${i + 1}] ${p.timestamp || ''} ${p.direcao || '?'} ASCII:${p.ascii || ''} OBS:${p.observacao || ''}`;
    });
    fs.writeFileSync(txtPath, linhasTxt.join('\n'), 'utf8');

    const buffers = payload.pacotes
      .map((p) => {
        if (p.buffer_hex) return Buffer.from(p.buffer_hex, 'hex');
        if (p.hex) return Buffer.from(String(p.hex).replace(/\s+/g, ''), 'hex');
        return null;
      })
      .filter(Boolean);

    let binGravado = null;
    if (buffers.length) {
      fs.writeFileSync(binPath, Buffer.concat(buffers));
      binGravado = binPath;
    }

    const csvHeader = 'indice,timestamp,direcao,ip,porta,driver,tamanho,hex,ascii,categoria,observacao\n';
    const csvLinhas = payload.pacotes.map((p, i) => {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        i + 1,
        esc(p.timestamp),
        esc(p.direcao),
        esc(p.ip || p.host),
        esc(p.porta),
        esc(p.driver),
        esc(p.tamanho || p.bytes),
        esc(p.hex),
        esc(p.ascii),
        esc(p.categoria),
        esc(p.observacao)
      ].join(',');
    });
    fs.writeFileSync(csvPath, csvHeader + csvLinhas.join('\n'), 'utf8');

    fs.writeFileSync(wirePath, wiresharkFormat.gerarDeSessao(payload), 'utf8');

    return {
      id,
      json: jsonPath,
      hex: hexPath,
      txt: txtPath,
      bin: binGravado,
      csv: csvPath,
      wireshark: wirePath,
      total_pacotes: payload.pacotes.length
    };
  }
}

const captureExporter = new CaptureExporter();

module.exports = captureExporter;
module.exports.CaptureExporter = CaptureExporter;
