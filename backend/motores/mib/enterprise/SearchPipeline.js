'use strict';

const { tokenizar } = require('../core/tokenizer');
const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');

/**
 * Pipeline padronizado RC3.0:
 * Consulta → Tokenização → Stop Words → Sinônimos → Provider → Ranking → Cache → Resultado
 */
class SearchPipeline {
  /**
   * @param {{
   *   sinonimos?: import('../core/SinonimosService'),
   *   cache?: import('../cache/AdaptiveCache'),
   *   learning?: import('../core/LearningEngine')
   * }} deps
   */
  constructor(deps = {}) {
    this.sinonimos = deps.sinonimos || null;
    this.cache = deps.cache || null;
    this.learning = deps.learning || null;
  }

  /**
   * Pré-processa a consulta (tokens, stop words, sinônimos).
   */
  preprocess(query, opcoes = {}) {
    const tok = tokenizar(query);
    let tokensExpandidos = tok.tokensNorm;
    if (this.sinonimos && opcoes.ativarSinonimos !== false) {
      tokensExpandidos = this.sinonimos.expandir(tok.tokensNorm);
    }
    return {
      bruto: String(query || '').trim(),
      normalizado: tok.normalizado || normalizarNomeBusca(query),
      tokens: tok.tokens,
      tokensNorm: tok.tokensNorm,
      tokensExpandidos
    };
  }

  chaveCache(entity, preprocessado, ctx) {
    return `E3|${entity}|${ctx.modoFiscal ? 'F' : 'N'}|${ctx.operador_id || 0}|${ctx.limite || 20}|${preprocessado.normalizado}`;
  }

  getCache(chave) {
    if (!this.cache) return null;
    return this.cache.get(chave);
  }

  setCache(chave, itens, meta) {
    if (!this.cache) return;
    this.cache.set(chave, itens, meta);
  }
}

module.exports = SearchPipeline;
