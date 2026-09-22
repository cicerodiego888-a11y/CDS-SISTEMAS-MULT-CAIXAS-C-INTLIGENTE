/**
 * Fila única por CNPJ + ambiente — uma consulta ativa por vez.
 */
'use strict';

const { chaveIdentidade, ESTADOS_SOLICITACAO } = require('./sefazGateConstants');

class SEFAZQueryQueue {
  constructor() {
    /** @type {Map<string, { running: object|null, waiting: Array<object> }>} */
    this._filas = new Map();
  }

  _bucket(cnpj, ambiente) {
    const key = chaveIdentidade(cnpj, ambiente);
    if (!this._filas.has(key)) {
      this._filas.set(key, { running: null, waiting: [] });
    }
    return { key, bucket: this._filas.get(key) };
  }

  snapshot(cnpj, ambiente) {
    const { bucket } = this._bucket(cnpj, ambiente);
    return {
      em_execucao: bucket.running
        ? {
          request_id: bucket.running.request_id,
          tipo: bucket.running.tipo,
          origem: bucket.running.origem
        }
        : null,
      fila: bucket.waiting.map((w) => ({
        request_id: w.request_id,
        tipo: w.tipo,
        origem: w.origem,
        status: w.status
      })),
      tamanho_fila: bucket.waiting.length
    };
  }

  /**
   * Enfileira e aguarda exclusividade. resolve com token de liberação.
   */
  async adquirir(solicitacao) {
    const { cnpj, ambiente } = solicitacao;
    const { bucket } = this._bucket(cnpj, ambiente);

    if (!bucket.running) {
      bucket.running = solicitacao;
      solicitacao.status = ESTADOS_SOLICITACAO.AUTHORIZED;
      return this._token(cnpj, ambiente, solicitacao);
    }

    solicitacao.status = ESTADOS_SOLICITACAO.QUEUED;
    return new Promise((resolve, reject) => {
      solicitacao._resolveFila = resolve;
      solicitacao._rejectFila = reject;
      bucket.waiting.push(solicitacao);
    });
  }

  _token(cnpj, ambiente, solicitacao) {
    let liberado = false;
    return {
      request_id: solicitacao.request_id,
      liberar: () => {
        if (liberado) return;
        liberado = true;
        this._avancar(cnpj, ambiente, solicitacao);
      }
    };
  }

  _avancar(cnpj, ambiente, atual) {
    const { bucket } = this._bucket(cnpj, ambiente);
    if (bucket.running && bucket.running.request_id === atual.request_id) {
      bucket.running = null;
    }
    const proximo = bucket.waiting.shift();
    if (!proximo) return;
    bucket.running = proximo;
    proximo.status = ESTADOS_SOLICITACAO.AUTHORIZED;
    const token = this._token(cnpj, ambiente, proximo);
    if (typeof proximo._resolveFila === 'function') {
      proximo._resolveFila(token);
    }
  }

  cancelarEspera(requestId) {
    for (const bucket of this._filas.values()) {
      const idx = bucket.waiting.findIndex((w) => w.request_id === requestId);
      if (idx >= 0) {
        const [item] = bucket.waiting.splice(idx, 1);
        if (typeof item._rejectFila === 'function') {
          item._rejectFila(new Error('Solicitação cancelada na fila.'));
        }
      }
    }
  }

  _resetForTests() {
    this._filas.clear();
  }
}

module.exports = {
  SEFAZQueryQueue,
  queryQueuePadrao: new SEFAZQueryQueue()
};
