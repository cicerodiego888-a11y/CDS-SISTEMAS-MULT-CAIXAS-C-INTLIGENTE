/**
 * ReplayManager — Reprodução de pacotes capturados.
 *
 * @class ReplayManager
 */

const packetComparator = require('./PacketComparator');
const frameStudio = require('./FrameStudio');

class ReplayManager {
  /**
   * Reenvia pacote e compara resposta.
   * @param {Object} ctx - { protocol, pacote, timeout? }
   * @returns {Promise<Object>}
   */
  async reenviarPacote(ctx = {}) {
    const { protocol, pacote, timeout = 3000 } = ctx;
    if (!protocol || typeof protocol.write !== 'function') {
      throw new Error('Protocolo inválido para replay');
    }
    if (!pacote) {
      throw new Error('Pacote não informado');
    }

    let buffer;
    if (pacote.buffer_hex) {
      buffer = Buffer.from(pacote.buffer_hex, 'hex');
    } else if (pacote.hex) {
      buffer = frameStudio.hexParaAscii(pacote.hex).buffer;
    } else if (pacote.ascii) {
      buffer = Buffer.from(pacote.ascii, 'utf8');
    } else {
      throw new Error('Pacote sem dados para replay');
    }

    const inicio = Date.now();
    await protocol.write(buffer, { operacao: 'replay', comando: pacote.comando || 'REPLAY' });
    let resposta = null;
    let erro = null;

    try {
      const raw = await protocol.read({ timeout, operacao: 'replay_rx', comando: pacote.comando });
      const dados = raw.dados || raw.buffer;
      resposta = frameStudio.visualizarBytes(dados, { replay: true });
    } catch (err) {
      erro = err.message;
    }

    const tempoMs = Date.now() - inicio;
    const enviado = frameStudio.visualizarBytes(buffer, { replay: true });

    let comparacao = null;
    if (resposta && pacote.resposta_esperada_hex) {
      comparacao = packetComparator.compararBuffers(
        Buffer.from(pacote.resposta_esperada_hex, 'hex'),
        resposta.buffer
      );
    }

    return {
      sucesso: !erro,
      enviado,
      resposta,
      erro,
      tempo_ms: tempoMs,
      comparacao
    };
  }

  /**
   * Replay de item de captura por índice.
   * @param {Object} captura
   * @param {number} indice
   * @param {Object} protocol
   * @returns {Promise<Object>}
   */
  async replayDaCaptura(captura, indice, protocol) {
    const pacotes = captura?.pacotes || [];
    const pacote = pacotes[indice];
    if (!pacote) {
      throw new Error(`Índice de pacote inválido: ${indice}`);
    }
    return this.reenviarPacote({ protocol, pacote });
  }
}

const replayManager = new ReplayManager();

module.exports = replayManager;
module.exports.ReplayManager = ReplayManager;
