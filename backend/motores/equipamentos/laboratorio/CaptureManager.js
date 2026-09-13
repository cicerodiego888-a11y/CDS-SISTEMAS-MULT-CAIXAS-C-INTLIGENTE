/**
 * CaptureManager — Captura e persistência de sessões de comunicação.
 *
 * Salva JSON, HEX, TXT e BIN em disco.
 *
 * @class CaptureManager
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function diretorioCapturas() {
  const base = process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'CDS Sistemas', 'laboratorio-equipamentos', 'capturas')
    : path.join(process.cwd(), 'dados-app', 'laboratorio-equipamentos', 'capturas');

  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

class CaptureManager {
  constructor() {
    /** @type {boolean} */
    this._capturando = false;
    /** @type {Object|null} */
    this._sessaoAtual = null;
    /** @type {Object[]} */
    this._buffer = [];
  }

  /**
   * @param {Object} [meta]
   * @returns {Object}
   */
  iniciarCaptura(meta = {}) {
    this._capturando = true;
    this._buffer = [];
    this._sessaoAtual = {
      id: `cap-${Date.now()}`,
      iniciada_em: new Date().toISOString(),
      hostname: os.hostname(),
      ...meta
    };
    return { capturando: true, sessao: this._sessaoAtual };
  }

  /**
   * @returns {Object}
   */
  pararCaptura() {
    this._capturando = false;
    const sessao = {
      ...this._sessaoAtual,
      finalizada_em: new Date().toISOString(),
      total_pacotes: this._buffer.length,
      pacotes: [...this._buffer]
    };
    this._sessaoAtual = null;
    return { capturando: false, sessao };
  }

  /**
   * @param {Object} pacote
   */
  registrarPacote(pacote) {
    if (!this._capturando) return;
    this._buffer.push({ ...pacote, capturado_em: new Date().toISOString() });
  }

  /**
   * @param {Object} sessao
   * @param {string} [nomeArquivo]
   * @returns {Promise<Object>}
   */
  async exportar(sessao, nomeArquivo) {
    const dados = sessao?.pacotes ? sessao : { pacotes: this._buffer, ...this._sessaoAtual };
    const id = nomeArquivo || dados.id || `captura-${Date.now()}`;
    const dir = diretorioCapturas();
    const basePath = path.join(dir, id);

    const jsonPath = `${basePath}.json`;
    const hexPath = `${basePath}.hex.txt`;
    const txtPath = `${basePath}.txt`;
    const binPath = `${basePath}.bin`;

    const payload = {
      ...dados,
      exportado_em: new Date().toISOString(),
      pacotes: dados.pacotes || []
    };

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

    const linhasHex = (payload.pacotes || []).map((p, i) => {
      const dir = p.direcao || '?';
      return `[${i + 1}] ${p.timestamp || ''} ${dir} ${p.hex || ''}`;
    });
    fs.writeFileSync(hexPath, linhasHex.join('\n'), 'utf8');

    const linhasTxt = (payload.pacotes || []).map((p, i) => {
      return `[${i + 1}] ${p.timestamp || ''} ${p.direcao || '?'} ASCII:${p.ascii || ''}`;
    });
    fs.writeFileSync(txtPath, linhasTxt.join('\n'), 'utf8');

    const buffers = (payload.pacotes || [])
      .map((p) => {
        if (p.buffer_hex) return Buffer.from(p.buffer_hex, 'hex');
        if (p.hex) return Buffer.from(String(p.hex).replace(/\s+/g, ''), 'hex');
        return null;
      })
      .filter(Boolean);
    if (buffers.length) {
      fs.writeFileSync(binPath, Buffer.concat(buffers));
    }

    return {
      id,
      json: jsonPath,
      hex: hexPath,
      txt: txtPath,
      bin: buffers.length ? binPath : null,
      total_pacotes: payload.pacotes.length
    };
  }

  /**
   * @param {string} caminhoJson
   * @returns {Object}
   */
  importar(caminhoJson) {
    const raw = fs.readFileSync(caminhoJson, 'utf8');
    return JSON.parse(raw);
  }

  /**
   * @returns {Object[]}
   */
  listarCapturas() {
    const dir = diretorioCapturas();
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    return arquivos.map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      let meta = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        meta = {
          equipamento_id: parsed.equipamento_id,
          driver: parsed.driver,
          total_pacotes: (parsed.pacotes || []).length
        };
      } catch (_) {
        meta = {};
      }
      return {
        id: f.replace(/\.json$/, ''),
        arquivo: full,
        tamanho_bytes: stat.size,
        modificado_em: stat.mtime.toISOString(),
        ...meta
      };
    }).sort((a, b) => b.modificado_em.localeCompare(a.modificado_em));
  }

  /**
   * @param {string} id
   * @returns {Object}
   */
  abrirCaptura(id) {
    const dir = diretorioCapturas();
    const jsonPath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Captura não encontrada: ${id}`);
    }
    return this.importar(jsonPath);
  }

  estaCapturando() {
    return this._capturando;
  }

  obterSessaoAtual() {
    return {
      capturando: this._capturando,
      sessao: this._sessaoAtual,
      pacotes: [...this._buffer]
    };
  }
}

const captureManager = new CaptureManager();

module.exports = captureManager;
module.exports.CaptureManager = CaptureManager;
module.exports.diretorioCapturas = diretorioCapturas;
