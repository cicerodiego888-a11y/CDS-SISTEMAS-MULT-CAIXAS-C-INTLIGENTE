/**
 * MIRX — Fila única de recuperação de XML (RC3.4.1).
 *
 * Nenhum componente deve consultar DistDFe/consChNFe de recuperação
 * diretamente: enfileira aqui → Worker único processa.
 *
 * @module motores/central-entradas/mirx/MirxQueue
 */

class MirxQueue {
  constructor() {
    /** @private @type {Map<number, Object>} */
    this._porDocumento = new Map();
    /** @private @type {number[]} */
    this._ordem = [];
  }

  /**
   * Enfileira ou atualiza solicitação de recuperação.
   * Prioridade: menor número = mais urgente (default 100).
   *
   * @param {Object} job
   * @param {number} job.documentoId
   * @param {string} [job.origem]
   * @param {string} [job.correlationId]
   * @param {number} [job.prioridade]
   * @param {boolean} [job.forcarAgora] — só admin/diagnóstico excepcional
   * @param {string} [job.motivo]
   * @returns {{ enfileirado: boolean, atualizado: boolean, job: Object }}
   */
  enqueue(job = {}) {
    const documentoId = Number(job.documentoId);
    if (!documentoId) {
      return { enfileirado: false, atualizado: false, job: null };
    }

    const existente = this._porDocumento.get(documentoId);
    const agora = new Date().toISOString();
    const novo = {
      documentoId,
      origem: job.origem || 'sistema',
      correlationId: job.correlationId || null,
      prioridade: Number(job.prioridade) >= 0 ? Number(job.prioridade) : 100,
      forcarAgora: job.forcarAgora === true,
      motivo: job.motivo || 'recuperacao_xml',
      enfileiradoEm: existente?.enfileiradoEm || agora,
      atualizadoEm: agora,
      tentativasEnfileiramento: (existente?.tentativasEnfileiramento || 0) + 1
    };

    if (existente) {
      // Mantém prioridade mais urgente e preserva forcarAgora se já pedido.
      novo.prioridade = Math.min(existente.prioridade, novo.prioridade);
      novo.forcarAgora = existente.forcarAgora || novo.forcarAgora;
      novo.correlationId = novo.correlationId || existente.correlationId;
      this._porDocumento.set(documentoId, novo);
      return { enfileirado: true, atualizado: true, job: novo };
    }

    this._porDocumento.set(documentoId, novo);
    this._ordem.push(documentoId);
    return { enfileirado: true, atualizado: false, job: novo };
  }

  /**
   * Próximo job devido (respeita ordem + prioridade).
   * @param {(job: Object) => boolean} [filtrar]
   * @returns {Object|null}
   */
  peek(filtrar) {
    const candidatos = [...this._porDocumento.values()]
      .filter((j) => (typeof filtrar === 'function' ? filtrar(j) : true))
      .sort((a, b) => {
        if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
        return String(a.enfileiradoEm).localeCompare(String(b.enfileiradoEm));
      });
    return candidatos[0] || null;
  }

  /**
   * Remove e retorna o próximo job.
   * @param {(job: Object) => boolean} [filtrar]
   * @returns {Object|null}
   */
  dequeue(filtrar) {
    const job = this.peek(filtrar);
    if (!job) return null;
    this.remove(job.documentoId);
    return job;
  }

  remove(documentoId) {
    const id = Number(documentoId);
    if (!this._porDocumento.has(id)) return false;
    this._porDocumento.delete(id);
    this._ordem = this._ordem.filter((x) => x !== id);
    return true;
  }

  has(documentoId) {
    return this._porDocumento.has(Number(documentoId));
  }

  get(documentoId) {
    return this._porDocumento.get(Number(documentoId)) || null;
  }

  size() {
    return this._porDocumento.size;
  }

  listar() {
    return [...this._porDocumento.values()];
  }

  limpar() {
    this._porDocumento.clear();
    this._ordem = [];
  }
}

module.exports = MirxQueue;
