/**
 * Sprint 14.2 — FingerprintService
 * Identificação passiva: abre TCP, lê banner se houver, fecha imediatamente.
 * NÃO envia comandos de balança / NÃO mantém socket persistente.
 */

'use strict';

const net = require('net');
const crypto = require('crypto');
const ProtocolDetector = require('./ProtocolDetector');
const DriverResolver = require('./DriverResolver');
const FingerprintCandidate = require('./FingerprintCandidate');
const FingerprintRepository = require('./FingerprintRepository');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[fingerprint-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[fingerprint-v1]', msg, ctx || '')
    };
  }
  return logger;
}

/**
 * Conexão TCP efêmera: connect → (opcional read) → destroy.
 * Nunca escreve bytes de protocolo na balança.
 * @returns {Promise<{ok:boolean, buffer:Buffer, latencia:number|null, erro?:string}>}
 */
function capturarRespostaPassiva(host, porta, { timeoutMs = 600, readMs = 250 } = {}) {
  return new Promise((resolve) => {
    const inicio = process.hrtime.bigint();
    const socket = new net.Socket();
    const chunks = [];
    let finalizado = false;

    const concluir = (ok, erro) => {
      if (finalizado) return;
      finalizado = true;
      const latencia = Number(process.hrtime.bigint() - inicio) / 1e6;
      try { socket.removeAllListeners(); } catch (_) { /* ignore */ }
      try { socket.destroy(); } catch (_) { /* ignore */ }
      resolve({
        ok: Boolean(ok),
        buffer: Buffer.concat(chunks),
        latencia: ok ? Math.max(0, Math.round(latencia)) : null,
        erro: erro || null
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => concluir(chunks.length > 0 || socket.readable, 'timeout'));
    socket.once('error', (err) => concluir(false, err.message));
    socket.on('data', (buf) => {
      chunks.push(Buffer.from(buf));
      // Não mantém sessão — encerra após primeiro pacote ou janela curta
    });

    socket.once('connect', () => {
      // Apenas escuta; não envia comando.
      setTimeout(() => concluir(true), Math.max(50, Number(readMs) || 250));
    });

    try {
      socket.connect(Number(porta), String(host));
    } catch (err) {
      concluir(false, err.message);
    }
  });
}

function hashFingerprint(buffer, meta = {}) {
  const h = crypto.createHash('sha1');
  h.update(Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || '')));
  h.update(`|${meta.host || ''}|${meta.porta || ''}|${meta.protocol || ''}`);
  return h.digest('hex').slice(0, 24);
}

class FingerprintService {
  constructor(deps = {}) {
    this.detector = deps.detector || new ProtocolDetector();
    this.resolver = deps.resolver || new DriverResolver();
    this.repository = deps.repository || new FingerprintRepository();
    this.capturar = deps.capturar || capturarRespostaPassiva;
  }

  /**
   * @param {{host:string, porta:number}|object} candidate DeviceCandidate-like
   * @param {object} [opcoes]
   * @returns {Promise<FingerprintCandidate>}
   */
  async identificar(candidate, opcoes = {}) {
    const log = getLogger();
    const host = String(candidate.host || candidate.ip || '');
    const porta = Number(candidate.porta || candidate.porta_tcp || 0);

    if (!host || !porta) {
      const err = new Error('host e porta são obrigatórios para fingerprint.');
      err.statusCode = 400;
      err.code = 'FINGERPRINT_INPUT_INVALIDO';
      throw err;
    }

    await log.info('Fingerprint iniciado', {
      operacao: 'fingerprint_v1',
      contexto: { host, porta }
    });

    let buffer = Buffer.alloc(0);
    let latencia = null;

    // Testes / injeção controlada — nunca usado para comandos de balança
    if (opcoes.respostaSimulada != null) {
      buffer = Buffer.isBuffer(opcoes.respostaSimulada)
        ? opcoes.respostaSimulada
        : Buffer.from(String(opcoes.respostaSimulada), 'utf8');
      latencia = 0;
      await log.info('Resposta recebida', {
        operacao: 'fingerprint_v1',
        contexto: { host, porta, bytes: buffer.length, simulada: true }
      });
    } else if (opcoes.pularRede !== true) {
      const captura = await this.capturar(host, porta, {
        timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : 600,
        readMs: opcoes.readMs != null ? opcoes.readMs : 250
      });
      buffer = captura.buffer || Buffer.alloc(0);
      latencia = captura.latencia;
      await log.info('Resposta recebida', {
        operacao: 'fingerprint_v1',
        contexto: {
          host,
          porta,
          bytes: buffer.length,
          ok: captura.ok,
          latencia
        }
      });
    }

    const det = this.detector.detect(buffer);
    if (det.protocol) {
      await log.info('Protocolo identificado', {
        operacao: 'fingerprint_v1',
        contexto: { host, porta, protocol: det.protocol, confidence: det.confidence }
      });
    }

    const resolved = this.resolver.resolve(det.protocol, { confidence: det.confidence });
    await log.info('Driver resolvido', {
      operacao: 'fingerprint_v1',
      contexto: {
        host,
        porta,
        driver: resolved.driver,
        fabricante: resolved.fabricante,
        modelo: resolved.modelo
      }
    });

    const fingerprint = hashFingerprint(buffer, {
      host,
      porta,
      protocol: det.protocol
    });

    const candidato = new FingerprintCandidate({
      host,
      porta,
      protocolo: det.protocol,
      fabricante: resolved.fabricante,
      modelo: resolved.modelo,
      driver: resolved.driver,
      confidence: det.protocol ? Number(det.confidence) || 0 : 0,
      fingerprint,
      identificadoEm: new Date().toISOString()
    });

    if (opcoes.persistir !== false) {
      await this.repository.salvar(candidato.paraApi());
    }

    await log.info('Fingerprint finalizado', {
      operacao: 'fingerprint_v1',
      contexto: candidato.paraRespostaHttp()
    });

    return candidato;
  }
}

const fingerprintService = new FingerprintService();

module.exports = fingerprintService;
module.exports.FingerprintService = FingerprintService;
module.exports.capturarRespostaPassiva = capturarRespostaPassiva;
