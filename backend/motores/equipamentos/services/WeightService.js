/**
 * Sprint 14.9 — WeightService (integração PDV)
 *
 * Fluxo preparado:
 *   Produto Pesável → solicitar peso → WeightResult → preencher quantidade → PDV
 *
 * O disparo automático fica desabilitado por padrão (configuração futura).
 */

'use strict';

const toledoWeightEngine = require('../drivers/toledo/weight/ToledoWeightEngine');

const CONFIG_PADRAO = Object.freeze({
  autoReadOnPesavel: false,
  unidadePadrao: 'kg',
  timeoutMs: 2000
});

class WeightService {
  constructor(deps = {}) {
    this.engine = deps.engine || toledoWeightEngine;
    this.config = { ...CONFIG_PADRAO, ...(deps.config || {}) };
  }

  /**
   * Indica se o produto deve solicitar peso.
   */
  isProdutoPesavel(produto = {}) {
    return Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? produto.pesavel ?? 0) === 1
      || String(produto.unidade || '').toLowerCase() === 'kg';
  }

  /**
   * Solicita peso à balança (leitura única).
   * @returns {Promise<{peso, unidade, estabilidade, quantidade}>}
   */
  async solicitarPeso(opcoes = {}) {
    const result = await this.engine.readOnce({
      host: opcoes.host || opcoes.ip,
      porta: opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp,
      equipamento_id: opcoes.equipamento_id,
      timeout: opcoes.timeout != null ? opcoes.timeout : this.config.timeoutMs,
      persistir: opcoes.persistir !== false
    });

    return {
      ...result,
      quantidade: result.peso,
      preenchido: true
    };
  }

  /**
   * Prepara quantidade para o PDV a partir de WeightResult.
   * Não dispara leitura automática a menos que config.autoReadOnPesavel = true.
   */
  async prepararQuantidade(produto, opcoes = {}) {
    if (!this.isProdutoPesavel(produto)) {
      return {
        pesavel: false,
        quantidade: opcoes.quantidade != null ? Number(opcoes.quantidade) : 1,
        weight: null,
        auto: false
      };
    }

    if (!this.config.autoReadOnPesavel && opcoes.solicitar !== true) {
      return {
        pesavel: true,
        quantidade: null,
        weight: null,
        auto: false,
        pendente: true,
        mensagem: 'Produto pesável — aguardando solicitação explícita de peso'
      };
    }

    const weight = await this.solicitarPeso(opcoes);
    return {
      pesavel: true,
      quantidade: weight.quantidade,
      weight,
      auto: this.config.autoReadOnPesavel === true
    };
  }

  getConfig() {
    return { ...this.config };
  }

  setConfig(parcial = {}) {
    this.config = { ...this.config, ...parcial };
    return this.getConfig();
  }
}

const weightService = new WeightService();

module.exports = weightService;
module.exports.WeightService = WeightService;
module.exports.weightService = weightService;
module.exports.CONFIG_PADRAO = CONFIG_PADRAO;
