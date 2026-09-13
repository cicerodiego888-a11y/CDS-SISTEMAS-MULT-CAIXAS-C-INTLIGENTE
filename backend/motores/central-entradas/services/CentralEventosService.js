/**
 * CentralEventosService — Registro e consulta de eventos operacionais.
 *
 * @class CentralEventosService
 */

const CentralEventosRepository = require('../repositories/CentralEventosRepository');
const { TIPOS_EVENTO } = require('../config/centralEventosTipos');

class CentralEventosService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._repository = deps.eventosRepository ?? new CentralEventosRepository();
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async registrar(dados) {
    return this._repository.inserir(dados);
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<{ eventos: Object[], total: number }>}
   */
  async listarLog(filtros = {}) {
    const [eventos, total] = await Promise.all([
      this._repository.listar(filtros),
      this._repository.contar(filtros)
    ]);
    return { eventos, total };
  }

  /**
   * @returns {Promise<Object|null>}
   */
  async obterUltimoErroSync() {
    const erro = await this._repository.obterUltimoPorTipo(TIPOS_EVENTO.SYNC_ERRO);
    if (erro) return erro;
    const sync = await this._repository.obterUltimoPorTipo(TIPOS_EVENTO.SYNC_CONCLUIDA);
    if (sync?.sucesso === false) return sync;
    return null;
  }

  /**
   * @returns {Promise<Object|null>}
   */
  async obterUltimaSyncConcluida() {
    return this._repository.obterUltimoPorTipo(TIPOS_EVENTO.SYNC_CONCLUIDA);
  }

  /**
   * @returns {Promise<number|null>}
   */
  async obterTempoMedioSyncMs() {
    return this._repository.obterTempoMedioSyncMs();
  }
}

module.exports = CentralEventosService;
