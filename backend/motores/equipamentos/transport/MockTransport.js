/**
 * MockTransport — Transporte simulado para testes e desenvolvimento.
 *
 * Implementa toda a interface BaseTransport com respostas em memória.
 * Drivers devem utilizar MockTransport durante testes unitários.
 * Não acessa hardware, sockets ou bibliotecas externas.
 *
 * @class MockTransport
 */

const BaseTransport = require('./BaseTransport');
const loggerService = require('../services/LoggerService');

class MockTransport extends BaseTransport {
  constructor(config = {}) {
    super(config);
    /** @type {Array<Buffer|string>} Fila de envio simulada */
    this._filaEnvio = [];
    /** @type {Array<Buffer|string>} Buffer de recebimento simulado */
    this._bufferRecebimento = config.respostasSimuladas || [];
    /** @type {number} Latência simulada em ms */
    this._latenciaMs = config.latenciaMs ?? 0;
  }

  tipo() {
    return 'mock';
  }

  async _log(operacao, detalhe = {}) {
    await loggerService.logTransporte({
      transporte: 'mock',
      operacao,
      equipamento_id: this.config.equipamento_id ?? null,
      status: detalhe.status ?? 'ok',
      detalhe
    });
  }

  async conectar() {
    await this._log('conectar', { status: 'conectando' });
    this._conectado = true;
    await this._log('conectar', { status: 'conectado' });
    return this._stub('conectar', { conectado: true });
  }

  async desconectar() {
    await this._log('desconectar', { status: 'desconectando' });
    this._conectado = false;
    this._filaEnvio = [];
    await this._log('desconectar', { status: 'desconectado' });
    return this._stub('desconectar', { conectado: false });
  }

  async enviar(dados) {
    if (!this._conectado) {
      throw new Error('MockTransport: não conectado');
    }
    const payload = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));
    this._filaEnvio.push(payload);
    await this._log('enviar', { status: 'enviado', bytes: payload.length });
    return this._stub('enviar', { bytes: payload.length, fila: this._filaEnvio.length });
  }

  async receber(opcoes = {}) {
    if (!this._conectado) {
      throw new Error('MockTransport: não conectado');
    }
    const timeout = opcoes.timeout ?? this.config.timeout ?? 1000;
    if (this._latenciaMs > 0) {
      await new Promise((r) => setTimeout(r, this._latenciaMs));
    }
    const item = this._bufferRecebimento.shift() ?? null;
    await this._log('receber', { status: item ? 'recebido' : 'vazio', timeout });
    return this._stub('receber', { dados: item, vazio: !item });
  }

  async ping() {
    if (!this._conectado) {
      return this._stub('ping', { sucesso: false, latencia_ms: null });
    }
    const inicio = Date.now();
    if (this._latenciaMs > 0) {
      await new Promise((r) => setTimeout(r, this._latenciaMs));
    }
    const latencia = Date.now() - inicio;
    await this._log('ping', { status: 'ok', latencia_ms: latencia });
    return this._stub('ping', { latencia_ms: latencia });
  }

  async status() {
    return this._stub('status', {
      conectado: this._conectado,
      fila_envio: this._filaEnvio.length,
      buffer_recebimento: this._bufferRecebimento.length
    });
  }

  async reiniciar() {
    await this.desconectar();
    this._filaEnvio = [];
    this._bufferRecebimento = this.config.respostasSimuladas ? [...this.config.respostasSimuladas] : [];
    return this.conectar();
  }

  async configurar(novaConfig = {}) {
    this.config = { ...this.config, ...novaConfig };
    if (novaConfig.respostasSimuladas) {
      this._bufferRecebimento = [...novaConfig.respostasSimuladas];
    }
    if (novaConfig.latenciaMs != null) {
      this._latenciaMs = novaConfig.latenciaMs;
    }
    await this._log('configurar', { status: 'configurado' });
    return this._stub('configurar', { config: this.config });
  }

  /** Injeta resposta simulada no buffer de recebimento (uso em testes). */
  injetarResposta(dados) {
    this._bufferRecebimento.push(dados);
  }

  /** Retorna cópia da fila de envio (uso em testes). */
  obterFilaEnvio() {
    return [...this._filaEnvio];
  }
}

module.exports = MockTransport;
