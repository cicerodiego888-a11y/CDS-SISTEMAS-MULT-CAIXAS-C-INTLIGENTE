/**
 * UsbTransport — Infraestrutura de transporte USB.
 *
 * Prepara: vendorId, productId, endpoint, buffer.
 * NÃO acessa dispositivos USB nesta sprint.
 *
 * @class UsbTransport
 */

const BaseTransport = require('./BaseTransport');
const loggerService = require('../services/LoggerService');

class UsbTransport extends BaseTransport {
  constructor(config = {}) {
    super(config);
    this._vendorId = config.vendorId ?? null;
    this._productId = config.productId ?? null;
    this._endpoint = config.endpoint ?? null;
    /** @type {Array<Buffer|string>} */
    this._filaEnvio = [];
    /** @type {Array<Buffer|string>} */
    this._bufferRecebimento = [];
    // TODO (Sprint futura): this._dispositivo = null (usb/libusb)
  }

  tipo() {
    return 'usb';
  }

  async _log(operacao, detalhe = {}) {
    await loggerService.logTransporte({
      transporte: 'usb',
      operacao,
      equipamento_id: this.config.equipamento_id ?? null,
      vendorId: this._vendorId,
      productId: this._productId,
      status: detalhe.status ?? 'ok',
      detalhe
    });
  }

  async conectar() {
    await this._log('conectar', { status: 'conectando' });
    // TODO (Sprint futura): usb.findByIds(vendorId, productId)
    this._conectado = true;
    await this._log('conectar', { status: 'conectado' });
    return this._stub('conectar', {
      vendorId: this._vendorId,
      productId: this._productId,
      conectado: true
    });
  }

  async desconectar() {
    await this._log('desconectar', { status: 'desconectando' });
    // TODO (Sprint futura): dispositivo.close()
    this._conectado = false;
    await this._log('desconectar', { status: 'desconectado' });
    return this._stub('desconectar', { conectado: false });
  }

  async enviar(dados) {
    if (!this._conectado) {
      throw new Error('UsbTransport: não conectado');
    }
    const payload = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));
    this._filaEnvio.push(payload);
    // TODO (Sprint futura): endpoint.transfer(payload)
    await this._log('enviar', { status: 'enfileirado', bytes: payload.length });
    return this._stub('enviar', { bytes: payload.length, fila: this._filaEnvio.length });
  }

  async receber(opcoes = {}) {
    if (!this._conectado) {
      throw new Error('UsbTransport: não conectado');
    }
    const timeout = opcoes.timeout ?? this.config.timeout ?? 3000;
    const item = this._bufferRecebimento.shift() ?? null;
    await this._log('receber', { status: item ? 'recebido' : 'vazio', timeout });
    return this._stub('receber', { dados: item, timeout });
  }

  async ping() {
    if (!this._conectado) {
      return this._stub('ping', { sucesso: false });
    }
    await this._log('ping', { status: 'ok' });
    return this._stub('ping', { vendorId: this._vendorId, productId: this._productId });
  }

  async status() {
    return this._stub('status', {
      conectado: this._conectado,
      vendorId: this._vendorId,
      productId: this._productId,
      endpoint: this._endpoint,
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
    if (novaConfig.vendorId != null) this._vendorId = novaConfig.vendorId;
    if (novaConfig.productId != null) this._productId = novaConfig.productId;
    if (novaConfig.endpoint != null) this._endpoint = novaConfig.endpoint;
    this.config = { ...this.config, ...novaConfig };
    await this._log('configurar', { status: 'configurado' });
    return this._stub('configurar', {
      vendorId: this._vendorId,
      productId: this._productId,
      endpoint: this._endpoint
    });
  }

  /**
   * Probe rápido RC2: confirma dispositivo na enumeração USB (VID/PID).
   * Nunca mantém handle aberto.
   * @returns {Promise<{ ok: boolean, modo: string }>}
   */
  async probeRapido() {
    const { listarDispositivosUsb } = require('../discovery/deviceEnumeration');
    const vid = this._vendorId != null
      ? String(this._vendorId).replace(/^0x/i, '').toUpperCase().padStart(4, '0')
      : null;
    const pid = this._productId != null
      ? String(this._productId).replace(/^0x/i, '').toUpperCase().padStart(4, '0')
      : null;

    const lista = listarDispositivosUsb();
    const ok = lista.some((d) => {
      const dv = d.vid ? String(d.vid).toUpperCase() : null;
      const dp = d.pid ? String(d.pid).toUpperCase() : null;
      if (vid && pid) return dv === vid && dp === pid;
      if (vid) return dv === vid;
      return false;
    });
    return { ok, modo: 'enumeracao_usb' };
  }
}

module.exports = UsbTransport;
