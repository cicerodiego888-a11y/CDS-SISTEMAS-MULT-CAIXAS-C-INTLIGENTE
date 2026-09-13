/**
 * PacketHistory — Histórico de pacotes TX/RX (Sprint 10).
 *
 * Armazena comunicações em memória por chave de conexão/equipamento.
 *
 * @class PacketHistory
 */

const MAX_PADRAO = Number(process.env.EQUIPAMENTOS_PACKET_HISTORY_MAX || 500);

class PacketHistory {
  constructor(maxPorChave = MAX_PADRAO) {
    this._maxPorChave = maxPorChave;
    /** @type {Map<string, Object[]>} */
    this._historico = new Map();
  }

  /**
   * @param {Object} entry
   * @returns {Object}
   */
  adicionar(entry) {
    const chave = String(entry.chave || entry.equipamento_id || 'global');
    const lista = this._historico.get(chave) || [];
    lista.push({ ...entry, chave });
    if (lista.length > this._maxPorChave) {
      lista.splice(0, lista.length - this._maxPorChave);
    }
    this._historico.set(chave, lista);
    return entry;
  }

  /**
   * @param {string|number|null} chave
   * @param {Object} [opcoes]
   * @returns {Object[]}
   */
  listar(chave = null, opcoes = {}) {
    const limite = opcoes.limite ?? this._maxPorChave;

    if (chave == null) {
      const todos = [];
      for (const lista of this._historico.values()) {
        todos.push(...lista);
      }
      return todos.slice(-limite);
    }

    const key = String(chave);
    const lista = this._historico.get(key) || [];
    return lista.slice(-limite);
  }

  /**
   * @param {string|number|null} chave
   * @returns {number}
   */
  contar(chave = null) {
    if (chave == null) {
      let total = 0;
      for (const lista of this._historico.values()) total += lista.length;
      return total;
    }
    return (this._historico.get(String(chave)) || []).length;
  }

  /**
   * @param {string|number|null} chave
   */
  limpar(chave = null) {
    if (chave == null) {
      this._historico.clear();
      return;
    }
    this._historico.delete(String(chave));
  }

  /**
   * @param {string|number|null} chave
   * @returns {Object}
   */
  exportar(chave = null) {
    return {
      gerado_em: new Date().toISOString(),
      total: this.contar(chave),
      pacotes: this.listar(chave)
    };
  }

  reiniciar() {
    this._historico.clear();
  }
}

const packetHistory = new PacketHistory();

module.exports = packetHistory;
module.exports.PacketHistory = PacketHistory;
