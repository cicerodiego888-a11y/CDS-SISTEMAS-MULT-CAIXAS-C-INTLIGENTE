/**
 * CentralSincronizacaoService — Orquestração da sincronização DF-e na Central.
 *
 * RC4: obtém contexto via CentralConfiguracaoService (sem leitura fiscal direta).
 *
 * @class CentralSincronizacaoService
 */

const SincronizacaoResultadoDTO = require('../contracts/SincronizacaoResultadoDTO');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralConfiguracaoService = require('./CentralConfiguracaoService');
const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const CentralNsuService = require('./CentralNsuService');
const {
  sincronizarDistribuicaoDFe,
  consultarNotaPorChave
} = require('../../../services/fiscal/distribuicaoDFe');
const { paraInboxDTO } = require('../utils/centralEntradasMapper');

class CentralSincronizacaoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository ?? new CentralDocumentosRepository();
    /** @private */
    this._configuracao = deps.configuracaoService ?? new CentralConfiguracaoService();
    /** @private */
    this._nsuRepository = deps.nsuRepository
      ?? new CentralNsuRepository({ db: deps.db ?? null });
    /** @private */
    this._nsuService = deps.nsuService
      ?? new CentralNsuService({ nsuRepository: this._nsuRepository });
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async sincronizar(opcoes = {}) {
    try {
      const ctxResult = await this._configuracao.obterContextoOperacional();
      if (!ctxResult.ok) {
        return SincronizacaoResultadoDTO.create({
          sucesso: false,
          notasNovas: 0,
          notasDuplicadas: 0,
          erros: [ctxResult.mensagem],
          mensagem: ctxResult.mensagem,
          mensagemAmigavel: ctxResult.mensagem,
          codigoErro: ctxResult.codigoErro
        }).toJSON();
      }

      const resultado = await sincronizarDistribuicaoDFe({
        maxIteracoes: opcoes.maxIteracoes ?? ctxResult.contexto.syncMaxDocumentos,
        contextoCentral: ctxResult.contexto,
        nsuRepository: this._nsuRepository,
        nsuService: this._nsuService,
        correlationId: opcoes.correlationId || null
      });

      return SincronizacaoResultadoDTO.create({
        sucesso: resultado.sucesso !== false,
        notasNovas: resultado.notasNovas,
        notasDuplicadas: resultado.notasDuplicadas,
        ignorados: resultado.ignorados,
        ultNsu: resultado.ultNsu,
        maxNsu: resultado.maxNsu,
        iteracoes: resultado.iteracoes,
        cStat: resultado.cStat,
        mensagem: resultado.mensagem,
        ultimaSincronizacao: resultado.ultimaSincronizacao,
        erros: resultado.sucesso === false ? [resultado.mensagem].filter(Boolean) : []
      }).toJSON();
    } catch (error) {
      const mensagem = error.message || String(error);
      const codigoErro = /certificado/i.test(mensagem)
        ? 'CERTIFICADO'
        : /cnpj/i.test(mensagem)
          ? 'CNPJ'
          : /timeout|ECONN/i.test(mensagem)
            ? 'SEFAZ'
            : 'SEFAZ';
      return SincronizacaoResultadoDTO.create({
        sucesso: false,
        notasNovas: 0,
        notasDuplicadas: 0,
        erros: [mensagem],
        mensagem,
        mensagemAmigavel: mensagem,
        codigoErro
      }).toJSON();
    }
  }

  /**
   * @param {string} chave
   * @returns {Promise<Object>}
   */
  async buscarPorChave(chave) {
    const ctxResult = await this._configuracao.obterContextoOperacional();
    if (!ctxResult.ok) {
      const erro = new Error(ctxResult.mensagem);
      erro.statusCode = 422;
      erro.codigoErro = ctxResult.codigoErro;
      throw erro;
    }

    const chaveLimpa = String(chave || '').replace(/\D/g, '');

    // RC3.4.1 — Gate único também cobre consChNFe (buscar-chave).
    try {
      const gate = require('./CentralSefazOperationalGate');
      const auth = await gate.autorizarConsultaDistDfe({
        chave: chaveLimpa,
        motivo: 'buscar_chave_consChNFe',
        origem: 'api'
      });
      if (!auth.permitido) {
        const erro = new Error(auth.mensagem || 'Consulta bloqueada pelo Gate SEFAZ.');
        erro.statusCode = 429;
        erro.codigoErro = auth.codigo;
        erro.detalhe = auth;
        throw erro;
      }
    } catch (gateErr) {
      if (gateErr.statusCode) throw gateErr;
      // Gate indisponível: não bloqueia busca manual pontual (compat).
    }

    const resultado = await consultarNotaPorChave(chaveLimpa, {
      contextoCentral: ctxResult.contexto
    });

    try {
      if (resultado?.cStat) {
        await require('./CentralSefazOperationalGate').processarRespostaSefaz(resultado, {
          chave: chaveLimpa
        });
      }
    } catch { /* ignore */ }

    const documento = await this._documentosRepository.buscarPorChave(chaveLimpa);

    return {
      ...resultado,
      novo: resultado.notasNovas > 0,
      documento: documento ? paraInboxDTO(documento).toJSON() : null
    };
  }
}

module.exports = CentralSincronizacaoService;
