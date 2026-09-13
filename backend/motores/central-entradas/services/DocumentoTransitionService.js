/**
 * DocumentoTransitionService — Único ponto de transição de estados do documento fiscal.
 *
 * RC1: encapsula MaquinaEstadosDocumento + persistência + histórico.
 *
 * @class DocumentoTransitionService
 */

const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { normalizarStatus } = require('../core/DocumentoFiscalStatus');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoService = require('./CentralHistoricoService');

class DocumentoTransitionService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   * @param {import('./CentralHistoricoService')} [deps.historicoService]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository();
    /** @private */
    this._historicoService = deps.historicoService
      ?? new CentralHistoricoService({ historicoRepository: deps.historicoRepository });
  }

  /**
   * @param {number|string} id
   * @param {string} statusAtual
   * @param {string} statusNovo
   * @param {Object} [opcoes]
   * @returns {Promise<void>}
   */
  async transicionar(id, statusAtual, statusNovo, opcoes = {}) {
    const atual = normalizarStatus(statusAtual);
    const novo = normalizarStatus(statusNovo);
    const validacao = validarTransicao(atual, novo);
    if (!validacao.valido) {
      const erro = new Error(validacao.erro);
      erro.statusCode = 400;
      throw erro;
    }

    await this._documentosRepository.atualizar(id, {
      status: novo,
      statusDetalhe: opcoes.detalhe ?? null,
      usuarioId: opcoes.usuarioId ?? null
    });

    if (atual !== novo) {
      await this._historicoService.registrar({
        documentoId: id,
        statusAnterior: atual,
        statusNovo: novo,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: opcoes.detalhe ?? `Transição: ${atual} → ${novo}`,
        origem: opcoes.origem || null
      });
    }
  }

  /**
   * Transição com leitura do documento atual.
   *
   * @param {number|string} id
   * @param {string} statusNovo
   * @param {Object} [opcoes]
   * @returns {Promise<Object|null>}
   */
  async transicionarDocumento(id, statusNovo, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    await this.transicionar(id, documento.status, statusNovo, opcoes);
    return this._documentosRepository.buscarPorId(id);
  }
}

module.exports = DocumentoTransitionService;
