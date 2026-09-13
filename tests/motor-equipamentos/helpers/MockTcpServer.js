/**
 * MockTcpServer — Servidor TCP para testes do Motor Equipamentos.
 *
 * modos:
 * - echo (padrão): ecoa dados recebidos
 * - modoToledo: responde frames temporários Sprint 11A com ACK/RS
 */

const net = require('net');
const frameBuilder = require('../../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder');
const ToledoPrix4Parser = require('../../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Parser');

const parser = new ToledoPrix4Parser();

class MockTcpServer {
  constructor() {
    /** @type {import('net').Server|null} */
    this.server = null;
    this.port = null;
    this.host = '127.0.0.1';
    /** @type {import('net').Socket[]} */
    this.clients = [];
    this.received = [];
    this.modoToledo = false;
    this.responderNak = false;
  }

  /**
   * @param {Buffer} data
   * @returns {Buffer}
   * @private
   */
  _respostaToledo(data) {
    if (this.responderNak) {
      return frameBuilder.buildNak('NAK simulado para teste');
    }

    const frame = parser.parseFrame(data);
    if (!frame) {
      return frameBuilder.buildAck({ generico: true });
    }

    if (frame.comando === 'ST') {
      return frameBuilder.buildRespostaStatus({ online: true, firmware: '90AX-sim' });
    }

    if (frame.comando === 'PW') {
      return frameBuilder.buildRespostaPeso({ valor: 1.25, unidade: 'kg', estavel: true });
    }

    return frameBuilder.buildAck({ comando: frame.comando, referencia: frame.payload });
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<MockTcpServer>}
   */
  async iniciar(opcoes = {}) {
    this.modoToledo = opcoes.modoToledo === true;
    this.responderNak = opcoes.responderNak === true;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.clients.push(socket);

        socket.on('data', (data) => {
          this.received.push(data);

          if (this.modoToledo) {
            socket.write(this._respostaToledo(data));
          } else if (opcoes.echo !== false) {
            socket.write(data);
          }
        });

        socket.on('close', () => {
          this.clients = this.clients.filter((c) => c !== socket);
        });

        if (typeof opcoes.onConnect === 'function') {
          opcoes.onConnect(socket);
        }
      });

      this.server.on('error', reject);

      this.server.listen(0, this.host, () => {
        const addr = this.server.address();
        this.port = typeof addr === 'object' ? addr.port : null;
        resolve(this);
      });
    });
  }

  /**
   * @returns {Promise<void>}
   */
  async parar() {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients = [];

    if (!this.server) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        this.server = null;
        this.port = null;
        resolve();
      });
    });
  }

  /**
   * @param {string|Buffer} dados
   */
  enviarParaTodos(dados) {
    const buf = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));
    for (const client of this.clients) {
      if (!client.destroyed) client.write(buf);
    }
  }

  /**
   * @param {number} ms
   */
  async atrasar(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = MockTcpServer;
