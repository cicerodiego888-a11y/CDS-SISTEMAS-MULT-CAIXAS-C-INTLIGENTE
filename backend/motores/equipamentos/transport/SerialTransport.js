/**
 * SerialTransport — Infraestrutura de transporte serial (RS-232/COM).
 *
 * Prepara: porta, baud rate, timeout, buffer.
 * NÃO utiliza serialport nesta sprint.
 *
 * @class SerialTransport
 */

const BaseTransport = require('./BaseTransport');
const loggerService = require('../services/LoggerService');

const BAUD_PADRAO = Number(process.env.EQUIPAMENTOS_SERIAL_BAUD || 9600);
const TIMEOUT_PADRAO = Number(process.env.EQUIPAMENTOS_SERIAL_TIMEOUT_MS || 3000);

class SerialTransport extends BaseTransport {
  constructor(config = {}) {
    super(config);
    this._porta = config.porta || config.path || 'COM1';
    this._baudRate = config.baudRate ?? config.baud ?? BAUD_PADRAO;
    this._timeout = config.timeout ?? TIMEOUT_PADRAO;
    /** @type {Array<Buffer|string>} */
    this._filaEnvio = [];
    /** @type {Array<Buffer|string>} */
    this._bufferRecebimento = [];
    // TODO (Sprint futura): this._portaSerial = null (SerialPort)
  }

  tipo() {
    return 'serial';
  }

  async _log(operacao, detalhe = {}) {
    await loggerService.logTransporte({
      transporte: 'serial',
      operacao,
      equipamento_id: this.config.equipamento_id ?? null,
      porta: this._porta,
      baudRate: this._baudRate,
      status: detalhe.status ?? 'ok',
      detalhe
    });
  }

  async conectar() {
    await this._log('conectar', { status: 'conectando' });
    // TODO (Sprint futura): new SerialPort({ path, baudRate })
    this._conectado = true;
    await this._log('conectar', { status: 'conectado' });
    return this._stub('conectar', {
      porta: this._porta,
      baudRate: this._baudRate,
      conectado: true
    });
  }

  async desconectar() {
    await this._log('desconectar', { status: 'desconectando' });
    // TODO (Sprint futura): portaSerial.close()
    this._conectado = false;
    await this._log('desconectar', { status: 'desconectado' });
    return this._stub('desconectar', { conectado: false });
  }

  async enviar(dados) {
    if (!this._conectado) {
      throw new Error('SerialTransport: não conectado');
    }
    const payload = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));
    this._filaEnvio.push(payload);
    // TODO (Sprint futura): portaSerial.write(payload)
    await this._log('enviar', { status: 'enfileirado', bytes: payload.length });
    return this._stub('enviar', { bytes: payload.length, fila: this._filaEnvio.length });
  }

  async receber(opcoes = {}) {
    if (!this._conectado) {
      throw new Error('SerialTransport: não conectado');
    }
    const timeout = opcoes.timeout ?? this._timeout;
    // TODO (Sprint futura): ler do parser/stream com timeout
    const item = this._bufferRecebimento.shift() ?? null;
    await this._log('receber', { status: item ? 'recebido' : 'vazio', timeout });
    return this._stub('receber', { dados: item, timeout });
  }

  async ping() {
    if (!this._conectado) {
      return this._stub('ping', { sucesso: false, porta: this._porta });
    }
    await this._log('ping', { status: 'ok' });
    return this._stub('ping', { porta: this._porta, baudRate: this._baudRate });
  }

  async status() {
    return this._stub('status', {
      conectado: this._conectado,
      porta: this._porta,
      baudRate: this._baudRate,
      timeout: this._timeout,
      fila_envio: this._filaEnvio.length,
      buffer_recebimento: this._bufferRecebimento.length
    });
  }

  async reiniciar() {
    await this.desconectar();
    this._filaEnvio = [];
    this._bufferRecebimento = [];
    return this.conectar();
  }

  async configurar(novaConfig = {}) {
    if (novaConfig.porta || novaConfig.path) this._porta = novaConfig.porta || novaConfig.path;
    if (novaConfig.baudRate != null || novaConfig.baud != null) {
      this._baudRate = novaConfig.baudRate ?? novaConfig.baud;
    }
    if (novaConfig.timeout != null) this._timeout = novaConfig.timeout;
    this.config = { ...this.config, ...novaConfig };
    await this._log('configurar', { status: 'configurado' });
    return this._stub('configurar', { porta: this._porta, baudRate: this._baudRate });
  }

  /**
   * Probe rápido RC2: tenta open/close se serialport estiver disponível;
   * caso contrário valida existência da porta na enumeração OS.
   * Nunca mantém a porta aberta.
   * @param {Object} [opcoes]
   * @returns {Promise<{ ok: boolean, modo: string }>}
   */
  async probeRapido(opcoes = {}) {
    const timeout = opcoes.timeout ?? this._timeout;
    let SerialPortCtor = null;
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      SerialPortCtor = require('serialport').SerialPort;
    } catch (_) {
      SerialPortCtor = null;
    }

    if (SerialPortCtor) {
      return new Promise((resolve) => {
        let finalizado = false;
        const concluir = (ok, modo) => {
          if (finalizado) return;
          finalizado = true;
          resolve({ ok, modo });
        };
        let porta;
        try {
          porta = new SerialPortCtor({
            path: this._porta,
            baudRate: this._baudRate,
            autoOpen: false
          });
        } catch (err) {
          concluir(false, 'serialport_erro');
          return;
        }
        const timer = setTimeout(() => {
          try { if (porta.isOpen) porta.close(() => {}); } catch (_) { /* */ }
          concluir(false, 'serialport_timeout');
        }, Math.max(50, timeout));

        porta.open((err) => {
          clearTimeout(timer);
          if (err) {
            concluir(false, 'serialport_open_fail');
            return;
          }
          porta.close(() => concluir(true, 'serialport_open'));
        });
      });
    }

    // Sem serialport: existência via enumeração
    const { listarPortasSerial } = require('../discovery/deviceEnumeration');
    const existe = listarPortasSerial().some((p) => String(p.porta) === String(this._porta));
    return { ok: existe, modo: 'enumeracao' };
  }
}

module.exports = SerialTransport;
