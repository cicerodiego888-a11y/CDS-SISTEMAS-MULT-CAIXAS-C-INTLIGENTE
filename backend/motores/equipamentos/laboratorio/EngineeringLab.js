/**
 * Sprint 14.5 — EngineeringLab
 * Laboratório passivo: observa TX/RX do Driver sem alterar bytes.
 */

'use strict';

const CaptureSession = require('./CaptureSession');
const FrameCapture = require('./FrameCapture');
const FrameRepository = require('./FrameRepository');
const FrameAnalyzer = require('./FrameAnalyzer');
const FrameExporter = require('./FrameExporter');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[lab-v2]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[lab-v2]', msg, ctx || '')
    };
  }
  return logger;
}

class EngineeringLab {
  constructor(deps = {}) {
    this.repository = deps.repository || new FrameRepository();
    /** @type {CaptureSession|null} */
    this.session = null;
    /** @type {Array<object>} */
    this._framesMemoria = [];
    this._persistir = true;
  }

  /**
   * @param {{equipamento?:string, driver?:string, host?:string, porta?:number, persistir?:boolean}} opcoes
   */
  async start(opcoes = {}) {
    if (this.session && this.session.status !== 'STOPPED') {
      await this.stop();
    }
    this._framesMemoria = [];
    this._persistir = opcoes.persistir !== false;
    this.session = new CaptureSession({
      equipamento: opcoes.equipamento || (opcoes.host ? `${opcoes.host}:${opcoes.porta || ''}` : null),
      driver: opcoes.driver || null,
      host: opcoes.host || null,
      porta: opcoes.porta != null ? Number(opcoes.porta) : null,
      status: 'RECORDING'
    });

    if (this._persistir) {
      await this.repository.salvarSessao(this.session);
    }

    await getLogger().info('Sessão iniciada', {
      operacao: 'engineering_lab_v2',
      contexto: this.session.paraApi()
    });

    return this.session.paraApi();
  }

  async stop() {
    if (!this.session) {
      return { status: 'STOPPED', id: null };
    }
    this.session.stop();
    if (this._persistir) {
      await this.repository.salvarSessao(this.session);
    }
    const snap = this.session.paraApi();
    await getLogger().info('Sessão finalizada', {
      operacao: 'engineering_lab_v2',
      contexto: snap
    });
    return snap;
  }

  pause() {
    if (!this.session) return { status: 'STOPPED' };
    this.session.pause();
    return this.session.paraApi();
  }

  resume() {
    if (!this.session) return { status: 'STOPPED' };
    this.session.resume();
    return this.session.paraApi();
  }

  status() {
    if (!this.session) {
      return { status: 'STOPPED', gravando: false, session: null };
    }
    return {
      status: this.session.status,
      gravando: this.session.gravando,
      session: this.session.paraApi()
    };
  }

  /**
   * Observação passiva — NÃO altera bytes.
   * @param {'TX'|'RX'} direction
   * @param {Buffer} bytes
   * @param {object} [meta]
   */
  async observe(direction, bytes, meta = {}) {
    if (!this.session || !this.session.gravando) return null;

    const original = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    // Cópia defensiva para armazenamento — original do Driver permanece intacto.
    const registro = FrameCapture.capturar(direction, original, {
      host: meta.host != null ? meta.host : this.session.host,
      porta: meta.porta != null ? meta.porta : this.session.porta,
      sessionId: this.session.id,
      timestamp: meta.timestamp
    });

    // Integridade: hex do registro === hex do buffer original
    if (registro.frame_hex !== original.toString('hex')) {
      await getLogger().error('Integridade de frame violada', {
        operacao: 'engineering_lab_v2',
        contexto: { sessionId: this.session.id }
      });
      return null;
    }

    this.session.registrar(registro.direction);
    this._framesMemoria.push(registro);

    if (this._persistir) {
      try {
        await this.repository.salvarFrame(registro);
        await this.repository.salvarSessao(this.session);
      } catch (_) { /* não bloqueia Driver */ }
    }

    await getLogger().info(direction === 'TX' ? 'Frame TX' : 'Frame RX', {
      operacao: 'engineering_lab_v2',
      contexto: {
        sessionId: this.session.id,
        direction: registro.direction,
        size: registro.tamanho,
        checksum: registro.checksum
      }
    });
    await getLogger().info('Frame salvo', {
      operacao: 'engineering_lab_v2',
      contexto: { sessionId: this.session.id, size: registro.tamanho }
    });

    return {
      direction: registro.direction,
      timestamp: registro.timestamp,
      tamanho: registro.tamanho,
      checksum: registro.checksum,
      frame_hex: registro.frame_hex,
      frame_ascii: registro.frame_ascii,
      analysis: FrameAnalyzer.analyze(registro)
    };
  }

  observeTx(bytes, meta) {
    return this.observe('TX', bytes, meta);
  }

  observeRx(bytes, meta) {
    return this.observe('RX', bytes, meta);
  }

  async getSession(id) {
    const sid = String(id || (this.session && this.session.id) || '');
    if (!sid) return null;

    let sessionApi = null;
    if (this.session && this.session.id === sid) {
      sessionApi = this.session.paraApi();
    } else if (this._persistir) {
      const row = await this.repository.buscarSessao(sid);
      if (!row) return null;
      sessionApi = {
        id: row.id,
        iniciadoEm: row.iniciado_em,
        finalizadoEm: row.finalizado_em,
        equipamento: row.equipamento,
        driver: row.driver,
        host: row.host,
        porta: row.porta,
        totalFrames: row.frames,
        totalTX: row.total_tx,
        totalRX: row.total_rx,
        status: row.status
      };
    }

    let frames;
    if (this.session && this.session.id === sid) {
      frames = this._framesMemoria.map((f) => ({
        timestamp: f.timestamp,
        direction: f.direction,
        host: f.host,
        porta: f.porta,
        size: f.tamanho,
        checksum: f.checksum,
        frame_hex: f.frame_hex,
        frame_ascii: f.frame_ascii,
        analysis: FrameAnalyzer.analyze(f)
      }));
    } else {
      const rows = await this.repository.listarFrames(sid);
      frames = rows.map((r) => ({
        timestamp: r.timestamp,
        direction: r.direction,
        host: r.host,
        porta: r.porta,
        size: r.size,
        checksum: r.checksum,
        frame_hex: r.frame_hex,
        frame_ascii: r.frame_ascii,
        analysis: FrameAnalyzer.analyze(r)
      }));
    }

    return { session: sessionApi, frames };
  }

  async export(id, formato = 'JSON') {
    const data = await this.getSession(id);
    if (!data || !data.session) {
      const err = new Error('Sessão não encontrada');
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }
    const result = FrameExporter.exportar(formato, data.session, data.frames);
    await getLogger().info('Exportação realizada', {
      operacao: 'engineering_lab_v2',
      contexto: { sessionId: data.session.id, format: result.format }
    });
    return result;
  }
}

const engineeringLab = new EngineeringLab();

module.exports = engineeringLab;
module.exports.EngineeringLab = EngineeringLab;
module.exports.engineeringLab = engineeringLab;
