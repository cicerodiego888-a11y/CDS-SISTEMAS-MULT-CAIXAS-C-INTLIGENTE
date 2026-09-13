/**
 * PacketInspector — Visualizador enriquecido de pacotes do Laboratório.
 *
 * Lê PacketHistory / entradas do PacketLogger sem acoplamento a drivers.
 *
 * @class PacketInspector
 */

const packetHistory = require('../communication/PacketHistory');
const packetLogger = require('../communication/PacketLogger');
const HexViewer = require('../communication/HexViewer');

class PacketInspector {
  constructor() {
    /** @type {Object[]} Buffer em memória para sessão do laboratório */
    this._sessao = [];
    /** @type {Map<string, number>} timestamp TX para calcular latência */
    this._pendentesTx = new Map();
  }

  /**
   * Registra pacote na sessão do laboratório (hook do PacketLogger).
   * @param {Object} entry
   */
  registrarPacote(entry) {
    const enriquecido = this._enriquecer(entry);
    this._sessao.push(enriquecido);
    if (this._sessao.length > 2000) {
      this._sessao.splice(0, this._sessao.length - 2000);
    }
    return enriquecido;
  }

  /**
   * @param {Object} entry
   * @returns {Object}
   * @private
   */
  _enriquecer(entry) {
    const direcao = String(entry.direcao || 'TX').toUpperCase();
    const chaveLatencia = `${entry.chave || entry.equipamento_id}:${entry.comando || ''}`;
    let tempoRespostaMs = entry.tempo_ms ?? null;

    if (direcao === 'TX') {
      this._pendentesTx.set(chaveLatencia, Date.now());
    } else if (direcao === 'RX' && this._pendentesTx.has(chaveLatencia)) {
      tempoRespostaMs = Date.now() - this._pendentesTx.get(chaveLatencia);
      this._pendentesTx.delete(chaveLatencia);
    }

    const buf = entry.buffer || (entry.hex ? Buffer.from(String(entry.hex).replace(/\s+/g, ''), 'hex') : null);
    const visual = buf ? HexViewer.format(buf) : {
      hex: entry.hex || '',
      ascii: entry.ascii || '',
      tamanho: entry.tamanho || 0
    };

    return {
      id: `${entry.timestamp || Date.now()}-${direcao}-${this._sessao.length}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      direcao,
      tx: direcao === 'TX',
      rx: direcao === 'RX',
      hex: visual.hex,
      ascii: visual.ascii,
      bytes: visual.tamanho,
      tamanho: visual.tamanho,
      driver: entry.driver || null,
      equipamento_id: entry.equipamento_id ?? null,
      equipamento: entry.equipamento_id ?? null,
      ip: entry.host || null,
      porta: entry.porta ?? null,
      host: entry.host || null,
      chave: entry.chave || null,
      comando: entry.comando || null,
      operacao: entry.operacao || null,
      tempo_resposta_ms: tempoRespostaMs,
      ack: entry.ack === true,
      nak: entry.nak === true,
      erro: entry.resultado === 'ERRO' || entry.nak === true,
      timeout: entry.timeout === true,
      resultado: entry.resultado || null,
      retry: entry.retry ?? null,
      buffer_hex: buf ? buf.toString('hex') : null
    };
  }

  /**
   * @param {Object} [filtros]
   * @returns {Object[]}
   */
  listar(filtros = {}) {
    let lista = [...this._sessao];

    if (filtros.chave) {
      lista = lista.filter((p) => p.chave === filtros.chave);
    }
    if (filtros.equipamento_id != null) {
      lista = lista.filter((p) => String(p.equipamento_id) === String(filtros.equipamento_id));
    }
    if (filtros.direcao) {
      lista = lista.filter((p) => p.direcao === String(filtros.direcao).toUpperCase());
    }

    const limite = filtros.limite ?? 500;
    return lista.slice(-limite);
  }

  /**
   * Mescla histórico global do PacketHistory com sessão local.
   * @param {string|number|null} chave
   * @param {Object} [opcoes]
   * @returns {Object[]}
   */
  listarHistoricoGlobal(chave = null, opcoes = {}) {
    const doHistory = packetLogger.listar(chave, opcoes).map((e) => this._enriquecer(e));
    const ids = new Set(doHistory.map((p) => p.timestamp + p.direcao + p.hex));
    const extras = this._sessao.filter((p) => !ids.has(p.timestamp + p.direcao + p.hex));
    return [...doHistory, ...extras].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }

  /**
   * @param {string|number|null} [chave]
   */
  limpar(chave = null) {
    if (!chave) {
      this._sessao = [];
      this._pendentesTx.clear();
      packetLogger.limpar();
      return;
    }
    this._sessao = this._sessao.filter((p) => p.chave !== String(chave));
    packetLogger.limpar(chave);
  }

  /**
   * @returns {Object}
   */
  exportarSessao() {
    return {
      gerado_em: new Date().toISOString(),
      total: this._sessao.length,
      pacotes: this._sessao
    };
  }

  reiniciar() {
    this._sessao = [];
    this._pendentesTx.clear();
  }
}

const packetInspector = new PacketInspector();

module.exports = packetInspector;
module.exports.PacketInspector = PacketInspector;
