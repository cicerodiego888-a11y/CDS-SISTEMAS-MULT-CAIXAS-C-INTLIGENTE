/**
 * Identificação de produto para o PDV via MIP (Sprint 05 + 09).
 *
 * Sprint 09 — MIP é o motor oficial do PDV:
 * - Sempre resolve via ProdutoIdentidadeService (flag global irrelevante).
 * - Não encontrado → o cliente PDV executa o fluxo legado como fallback.
 *
 * @module motores/produto-identidade/services/PdvProdutoIdentificacaoService
 */

const ProdutoIdentidadeService = require('./ProdutoIdentidadeService');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { FLAG_CHAVE } = require('../config/produtoIdentidadeFlags');

class PdvProdutoIdentificacaoService {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {ProdutoIdentidadeService} [deps.identidadeService]
   * @param {Function} [deps.isEnabled] — ignorado no PDV (Sprint 09); mantido por compatibilidade de testes
   */
  constructor(deps = {}) {
    this._db = deps.db ?? null;
    // Sprint 09: PDV sempre habilita o MIP neste consumidor
    this._identidade = deps.identidadeService
      ?? new ProdutoIdentidadeService({
        db: this._db,
        isEnabled: () => true
      });
  }

  /**
   * @param {string} codigo
   * @param {Object} [contexto]
   * @returns {Promise<Object>} payload JSON para o PDV
   */
  async identificar(codigo, contexto = {}) {
    const bruto = String(codigo ?? '').trim();
    const ctx = {
      origem: 'pdv',
      ...contexto
    };

    // DEBUG 01
    console.log('[MIP DEBUG] PdvProdutoIdentificacaoService.identificar → ProdutoIdentidadeService.resolve', {
      codigo: bruto,
      contexto: ctx
    });

    if (!bruto) {
      console.log('[MIP DEBUG] INTERRUPÇÃO: código vazio');
      return this._toPayload(
        IdentidadeResultadoDTO.naoEncontrado({ codigoOriginal: '' }),
        { modo: 'mip', fallbackLegado: true }
      );
    }

    const resultado = await this._identidade.resolve(
      { codigo: bruto, contexto: ctx },
      ctx
    );

    const encontrado = resultado && resultado.encontrado === true;
    console.log('[MIP DEBUG] Resultado resolve:', {
      encontrado,
      produtoId: resultado?.produtoId,
      strategy: resultado?.strategy,
      metodo: resultado?.metodo,
      nome: resultado?.produto?.nome || null
    });

    return this._toPayload(resultado, {
      modo: 'mip',
      fallbackLegado: !encontrado
    });
  }

  /**
   * Invalida lookups negativos/stale para o produto recém-cadastrado aparecer no PDV.
   */
  limparCacheCatalogo() {
    const cat = this._identidade && this._identidade.catalogo;
    if (cat && typeof cat.limparCache === 'function') {
      cat.limparCache();
    }
  }

  /**
   * @private
   */
  _toPayload(resultado, extras = {}) {
    const json = resultado && typeof resultado.toJSON === 'function'
      ? resultado.toJSON()
      : { ...(resultado || {}) };

    const ehBalanca = json.strategy === 'ETIQUETA_BALANCA'
      || (json.meta && (json.meta.tipoPayload === 'VALOR' || json.meta.tipoPayload === 'PESO'));

    const encontrado = json.encontrado === true;

    return {
      ...json,
      // PDV oficial sempre opera com MIP habilitado neste endpoint
      habilitado: true,
      flag: FLAG_CHAVE,
      modo: extras.modo || 'mip',
      fallbackLegado: extras.fallbackLegado === true || !encontrado,
      etiquetaBalanca: ehBalanca === true
    };
  }
}

module.exports = PdvProdutoIdentificacaoService;
