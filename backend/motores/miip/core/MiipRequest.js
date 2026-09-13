/**
 * MiipRequest — Requisição recebida pelo Pipeline MIIP.
 *
 * @class MiipRequest
 */

const ItemIdentificavelDTO = require('../contracts/ItemIdentificavelDTO');
const MiipContext = require('./MiipContext');

class MiipRequest {
  /**
   * @param {Object} [dados]
   * @param {import('../contracts/ItemIdentificavelDTO')|Object} [dados.item]
   * @param {import('./MiipContext')|Object} [dados.contexto]
   * @param {string|null} [dados.requestId]
   * @param {Object} [dados.metadados]
   */
  constructor(dados = {}) {
    this.item = dados.item instanceof ItemIdentificavelDTO
      ? dados.item
      : ItemIdentificavelDTO.create(dados.item ?? {});

    this.contexto = dados.contexto instanceof MiipContext
      ? dados.contexto
      : MiipContext.agora(dados.contexto ?? {});

    this.requestId = dados.requestId ?? null;
    this.metadados = dados.metadados ?? {};
    this.recebidoEm = dados.recebidoEm ?? new Date().toISOString();
  }

  /**
   * @param {Object} [dados]
   * @returns {MiipRequest}
   */
  static create(dados = {}) {
    return new MiipRequest(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      item: this.item?.toJSON?.() ?? this.item,
      contexto: this.contexto?.toJSON?.() ?? this.contexto,
      requestId: this.requestId,
      metadados: this.metadados,
      recebidoEm: this.recebidoEm
    };
  }
}

module.exports = MiipRequest;
