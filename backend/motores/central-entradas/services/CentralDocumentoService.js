/**
 * CentralDocumentoService — Operações de documento do inbox.
 *
 * Sprint 2: listagem paginada, filtros, ordenação e detalhe.
 *
 * @class CentralDocumentoService
 */

const CentralFiltroDTO = require('../contracts/CentralFiltroDTO');
const { paraListaInboxDTO, paraDocumentoDetalheDTO } = require('../utils/centralEntradasMapper');
const { montarMetadadosPaginacao } = require('../utils/paginacaoCentral');

class CentralDocumentoService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<{ documentos: Object[], paginacao: Object }>}
   */
  async listar(filtros = {}) {
    const dto = CentralFiltroDTO.create(filtros);
    const filtrosNormalizados = dto.toJSON();

    const [documentos, total] = await Promise.all([
      this._documentosRepository.listar(filtrosNormalizados),
      this._documentosRepository.contar(filtrosNormalizados)
    ]);

    return {
      documentos: paraListaInboxDTO(documentos),
      paginacao: montarMetadadosPaginacao(total, filtrosNormalizados)
    };
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async obterPorId(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    return paraDocumentoDetalheDTO(documento);
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async criar(dados) {
    const documento = await this._documentosRepository.inserir(dados);
    return paraDocumentoDetalheDTO(documento);
  }

  /**
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    const documento = await this._documentosRepository.atualizar(id, dados);
    return paraDocumentoDetalheDTO(documento);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async obterBrutoPorId(id) {
    return this._documentosRepository.buscarPorId(id);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async remover(id) {
    return this._documentosRepository.remover(id);
  }
}

module.exports = CentralDocumentoService;
