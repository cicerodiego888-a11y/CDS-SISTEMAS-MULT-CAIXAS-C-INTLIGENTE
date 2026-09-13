/**
 * CaptureImporter — Importação de capturas (Sprint 13).
 *
 * Suporta JSON, HEX (.hex.txt), TXT e BIN.
 */

const fs = require('fs');
const path = require('path');
const CaptureSession = require('./CaptureSession');
const frameAnalyzer = require('./FrameAnalyzer');
const { diretorioCapturas } = require('./paths');

class CaptureImporter {
  /**
   * Detecta formato pelo caminho/extensão.
   * @param {string} caminho
   * @returns {'json'|'hex'|'txt'|'bin'}
   */
  detectarFormato(caminho) {
    const lower = caminho.toLowerCase();
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.hex.txt') || lower.endsWith('.hex')) return 'hex';
    if (lower.endsWith('.bin')) return 'bin';
    return 'txt';
  }

  /**
   * @param {string} caminho
   * @returns {CaptureSession}
   */
  importar(caminho) {
    const formato = this.detectarFormato(caminho);
    switch (formato) {
      case 'json':
        return this.importarJSON(caminho);
      case 'hex':
        return this.importarHEX(caminho);
      case 'bin':
        return this.importarBIN(caminho);
      default:
        return this.importarTXT(caminho);
    }
  }

  /**
   * @param {string} caminho
   * @returns {CaptureSession}
   */
  importarJSON(caminho) {
    const raw = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    return CaptureSession.fromJSON(raw);
  }

  /**
   * @param {string} caminho
   * @returns {CaptureSession}
   */
  importarHEX(caminho) {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const linhas = conteudo.split(/\r?\n/).filter(Boolean);
    const sessao = new CaptureSession({ id: path.basename(caminho).replace(/\.hex\.txt$|\.hex$/i, '') });
    const regex = /^\[(\d+)\]\s+(\S+)\s+(TX|RX)\s+(.+)$/i;

    for (const linha of linhas) {
      const m = linha.match(regex);
      if (!m) continue;
      const hex = m[4].trim();
      const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex');
      const analise = frameAnalyzer.analisarFrame(buf);
      sessao.adicionarPacote({
        timestamp: m[2],
        direcao: m[3].toUpperCase(),
        hex: analise.hex,
        ascii: analise.ascii,
        tamanho: buf.length,
        buffer_hex: buf.toString('hex'),
        analise
      });
    }
    return sessao;
  }

  /**
   * @param {string} caminho
   * @returns {CaptureSession}
   */
  importarTXT(caminho) {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const linhas = conteudo.split(/\r?\n/).filter(Boolean);
    const sessao = new CaptureSession({ id: path.basename(caminho).replace(/\.txt$/i, '') });
    const regex = /^\[(\d+)\]\s+(\S+)\s+(TX|RX)\s+ASCII:(.+?)(?:\s+OBS:(.*))?$/i;

    for (const linha of linhas) {
      const m = linha.match(regex);
      if (!m) continue;
      const ascii = m[4];
      const buf = Buffer.from(ascii, 'utf8');
      const analise = frameAnalyzer.analisarFrame(buf);
      sessao.adicionarPacote({
        timestamp: m[2],
        direcao: m[3].toUpperCase(),
        ascii,
        hex: analise.hex,
        tamanho: buf.length,
        buffer_hex: buf.toString('hex'),
        observacao: m[5] || null,
        analise
      });
    }
    return sessao;
  }

  /**
   * @param {string} caminho
   * @param {Object} [meta]
   * @returns {CaptureSession}
   */
  importarBIN(caminho, meta = {}) {
    const buf = fs.readFileSync(caminho);
    const sessao = new CaptureSession({
      id: path.basename(caminho).replace(/\.bin$/i, ''),
      ...meta
    });
    const analise = frameAnalyzer.analisarFrame(buf);
    sessao.adicionarPacote({
      timestamp: new Date().toISOString(),
      direcao: meta.direcao || 'RX',
      hex: analise.hex,
      ascii: analise.ascii,
      tamanho: buf.length,
      buffer_hex: buf.toString('hex'),
      analise
    });
    return sessao;
  }

  /**
   * @param {string} id
   * @returns {CaptureSession}
   */
  abrirPorId(id) {
    const dir = diretorioCapturas();
    const jsonPath = path.join(dir, `${id}.json`);
    if (fs.existsSync(jsonPath)) return this.importarJSON(jsonPath);

    const hexPath = path.join(dir, `${id}.hex.txt`);
    if (fs.existsSync(hexPath)) return this.importarHEX(hexPath);

    const txtPath = path.join(dir, `${id}.txt`);
    if (fs.existsSync(txtPath)) return this.importarTXT(txtPath);

    const binPath = path.join(dir, `${id}.bin`);
    if (fs.existsSync(binPath)) return this.importarBIN(binPath);

    throw new Error(`Captura não encontrada: ${id}`);
  }

  /**
   * @returns {Object[]}
   */
  listarCapturas() {
    const dir = diretorioCapturas();
    if (!fs.existsSync(dir)) return [];

    const ids = new Set();
    fs.readdirSync(dir).forEach((f) => {
      const base = f.replace(/\.(json|hex\.txt|txt|bin|csv|wireshark\.txt)$/i, '');
      ids.add(base);
    });

    return [...ids].map((id) => {
      const jsonPath = path.join(dir, `${id}.json`);
      let meta = { id };
      if (fs.existsSync(jsonPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          meta = {
            id,
            driver: parsed.driver,
            equipamento_id: parsed.equipamento_id,
            total_pacotes: (parsed.pacotes || []).length,
            modificado_em: fs.statSync(jsonPath).mtime.toISOString()
          };
        } catch (_) {
          meta.modificado_em = fs.statSync(jsonPath).mtime.toISOString();
        }
      }
      return meta;
    }).sort((a, b) => String(b.modificado_em || '').localeCompare(String(a.modificado_em || '')));
  }
}

const captureImporter = new CaptureImporter();

module.exports = captureImporter;
module.exports.CaptureImporter = CaptureImporter;
