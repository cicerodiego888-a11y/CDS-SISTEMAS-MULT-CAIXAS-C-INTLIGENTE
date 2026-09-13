/**
 * BluetoothTransport — Infraestrutura de transporte Bluetooth.
 *
 * Prepara: endereço MAC, canal, timeout, buffer.
 * NÃO acessa dispositivos Bluetooth nesta sprint.
 *
 * @class BluetoothTransport
 */

const BaseTransport = require('./BaseTransport');
const loggerService = require('../services/LoggerService');

class BluetoothTransport extends BaseTransport {
  constructor(config = {}) {
    super(config);
    this._endereco = config.endereco || config.mac || null;
    this._canal = config.canal ?? config.channel ?? 1;
    this._timeout = config.timeout ?? 5000;
    /** @type {Array<Buffer|string>} */
    this._filaEnvio = [];
    /** @type {Array<Buffer|string>} */
    this._bufferRecebimento = [];
    // TODO (Sprint futura): this._socket = null (noble/bluetooth-serial)
  }

  tipo() {
    return 'bluetooth';
  }

  async _log(operacao, detalhe = {}) {
    await loggerService.logTransporte({
      transporte: 'bluetooth',
      operacao,
      equipamento_id: this.config.equipamento_id ?? null,
      endereco: this._endereco,
      status: detalhe.status ?? 'ok',
      detalhe
    });
  }

  async conectar() {
    await this._log('conectar', { status: 'conectando' });
    // TODO (Sprint futura): parear e abrir canal RFCOMM/BLE
    this._conectado = true;
    await this._log('conectar', { status: 'conectado' });
    return this._stub('conectar', {
      endereco: this._endereco,
      canal: this._canal,
      conectado: true
    });
  }

  async desconectar() {
    await this._log('desconectar', { status: 'desconectando' });
    // TODO (Sprint futura): fechar conexão BT
    this._conectado = false;
    await this._log('desconectar', { status: 'desconectado' });
    return this._stub('desconectar', { conectado: false });
  }

  async enviar(dados) {
    if (!this._conectado) {
      throw new Error('BluetoothTransport: não conectado');
    }
    const payload = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));
    this._filaEnvio.push(payload);
    // TODO (Sprint futura): socket.write(payload)
    await this._log('enviar', { status: 'enfileirado', bytes: payload.length });
    return this._stub('enviar', { bytes: payload.length, fila: this._filaEnvio.length });
  }

  async receber(opcoes = {}) {
    if (!this._conectado) {
      throw new Error('BluetoothTransport: não conectado');
    }
    const timeout = opcoes.timeout ?? this._timeout;
    const item = this._bufferRecebimento.shift() ?? null;
    await this._log('receber', { status: item ? 'recebido' : 'vazio', timeout });
    return this._stub('receber', { dados: item, timeout });
  }

  async ping() {
    if (!this._conectado) {
      return this._stub('ping', { sucesso: false, endereco: this._endereco });
    }
    await this._log('ping', { status: 'ok' });
    return this._stub('ping', { endereco: this._endereco, canal: this._canal });
  }

  async status() {
    return this._stub('status', {
      conectado: this._conectado,
      endereco: this._endereco,
      canal: this._canal,
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
    if (novaConfig.endereco || novaConfig.mac) {
      this._endereco = novaConfig.endereco || novaConfig.mac;
    }
    if (novaConfig.canal != null || novaConfig.channel != null) {
      this._canal = novaConfig.canal ?? novaConfig.channel;
    }
    if (novaConfig.timeout != null) this._timeout = novaConfig.timeout;
    this.config = { ...this.config, ...novaConfig };
    await this._log('configurar', { status: 'configurado' });
    return this._stub('configurar', { endereco: this._endereco, canal: this._canal });
  }
}

module.exports = BluetoothTransport;
