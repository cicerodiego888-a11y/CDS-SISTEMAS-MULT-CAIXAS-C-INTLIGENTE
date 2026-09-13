/**
 * CentralHistoricoService — Registro e consulta do histórico de transições.
 *
 * Sprint 2: histórico com labels e registro em mudanças de status.
 *
 * @class CentralHistoricoService
 */

const { paraHistoricoDTO } = require('../utils/centralEntradasMapper');
const { obterLabel } = require('../core/DocumentoFiscalStatus');

class CentralHistoricoService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralHistoricoRepository')} [deps.historicoRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._historicoRepository = deps.historicoRepository
      ?? new (require('../repositories/CentralHistoricoRepository'))();
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object[]>}
   */
  async listarPorDocumento(documentoId) {
    const entradas = await this._historicoRepository.listarPorDocumento(documentoId);
    return entradas.map((entrada) => {
      const dto = paraHistoricoDTO(entrada).toJSON();
      dto.statusAnteriorLabel = dto.statusAnterior ? obterLabel(dto.statusAnterior) : null;
      dto.statusNovoLabel = obterLabel(dto.statusNovo);
      return dto;
    });
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async registrar(dados) {
    const entrada = await this._historicoRepository.inserir(dados);
    const dto = paraHistoricoDTO(entrada).toJSON();
    dto.statusAnteriorLabel = dto.statusAnterior ? obterLabel(dto.statusAnterior) : null;
    dto.statusNovoLabel = obterLabel(dto.statusNovo);
    return dto;
  }
}

module.exports = CentralHistoricoService;
