/**
 * CaptureSession — Sessão de captura para engenharia reversa (Sprint 13).
 *
 * @class CaptureSession
 */

const { randomBytes } = require('crypto');

class CaptureSession {
  /**
   * @param {Object} [meta]
   */
  constructor(meta = {}) {
    const agora = new Date();
    this.id = meta.id || `sess-${Date.now()}-${randomBytes(3).toString('hex')}`;
    this.data = meta.data || agora.toISOString().slice(0, 10);
    this.hora = meta.hora || agora.toTimeString().slice(0, 8);
    this.iniciada_em = meta.iniciada_em || agora.toISOString();
    this.finalizada_em = meta.finalizada_em || null;
    this.driver = meta.driver || null;
    this.modelo = meta.modelo || null;
    this.equipamento_id = meta.equipamento_id ?? null;
    this.equipamento = meta.equipamento ?? meta.equipamento_id ?? null;
    this.ip = meta.ip || meta.host || null;
    this.porta = meta.porta ?? null;
    this.socket = meta.socket || meta.chave || null;
    this.observacoes = meta.observacoes || '';
    /** @type {Object[]} */
    this.pacotes = Array.isArray(meta.pacotes) ? [...meta.pacotes] : [];
    this._inicioMs = Date.now();
  }

  /**
   * @param {Object} pacote
   */
  adicionarPacote(pacote) {
    this.pacotes.push(pacote);
  }

  /**
   * @returns {number}
   */
  quantidadePacotes() {
    return this.pacotes.length;
  }

  /**
   * Duração da sessão em ms.
   * @returns {number}
   */
  tempoMs() {
    const fim = this.finalizada_em ? new Date(this.finalizada_em).getTime() : Date.now();
    return Math.max(0, fim - this._inicioMs);
  }

  /**
   * @param {string} texto
   */
  adicionarObservacao(texto) {
    const linha = `[${new Date().toISOString()}] ${texto}`;
    this.observacoes = this.observacoes ? `${this.observacoes}\n${linha}` : linha;
  }

  /**
   * @returns {Object}
   */
  finalizar() {
    this.finalizada_em = new Date().toISOString();
    return this.toJSON();
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      data: this.data,
      hora: this.hora,
      iniciada_em: this.iniciada_em,
      finalizada_em: this.finalizada_em,
      driver: this.driver,
      modelo: this.modelo,
      equipamento_id: this.equipamento_id,
      equipamento: this.equipamento,
      ip: this.ip,
      porta: this.porta,
      socket: this.socket,
      quantidade_pacotes: this.quantidadePacotes(),
      tempo_ms: this.tempoMs(),
      observacoes: this.observacoes,
      pacotes: this.pacotes
    };
  }

  /**
   * @param {Object} dados
   * @returns {CaptureSession}
   */
  static fromJSON(dados) {
    const sessao = new CaptureSession(dados);
    sessao.pacotes = dados.pacotes || [];
    sessao.finalizada_em = dados.finalizada_em || null;
    if (dados.iniciada_em) {
      sessao._inicioMs = new Date(dados.iniciada_em).getTime();
    }
    return sessao;
  }
}

module.exports = CaptureSession;
