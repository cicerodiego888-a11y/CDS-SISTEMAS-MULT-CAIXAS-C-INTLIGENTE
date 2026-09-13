/**
 * CentralHistoricoEntryDTO — Contrato de entrada do histórico de transições.
 *
 * @class CentralHistoricoEntryDTO
 */

class CentralHistoricoEntryDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id ?? null;
    this.documentoId = dados.documentoId ?? dados.documento_id ?? null;
    this.statusAnterior = dados.statusAnterior ?? dados.status_anterior ?? null;
    this.statusNovo = dados.statusNovo ?? dados.status_novo ?? null;
    this.usuarioId = dados.usuarioId ?? dados.usuario_id ?? null;
    this.detalhe = dados.detalhe ?? null;
    this.createdAt = dados.createdAt ?? dados.created_at ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {CentralHistoricoEntryDTO}
   */
  static create(plain) {
    return new CentralHistoricoEntryDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      documentoId: this.documentoId,
      statusAnterior: this.statusAnterior,
      statusNovo: this.statusNovo,
      usuarioId: this.usuarioId,
      detalhe: this.detalhe,
      createdAt: this.createdAt
    };
  }
}

module.exports = CentralHistoricoEntryDTO;
