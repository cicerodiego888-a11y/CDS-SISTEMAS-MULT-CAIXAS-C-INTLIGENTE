'use strict';

const ISearchProvider = require('./ISearchProvider');

/**
 * ProductProvider — delega ao MIB (motor cognitivo de produtos).
 */
class ProductProvider extends ISearchProvider {
  /**
   * @param {import('../../MibService')} mib
   */
  constructor(mib) {
    super();
    this.mib = mib;
  }

  get entity() { return 'produto'; }
  get aliases() {
    return ['produtos', 'product', 'products', 'item', 'itens'];
  }
  get permissao() { return 'produtos'; }

  indexSpec() {
    return {
      tabela: 'produtos',
      indices: [
        'CREATE INDEX IF NOT EXISTS idx_produtos_nome_busca ON produtos(nome_busca)',
        'CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos(codigo)',
        'CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(codigo_barras)'
      ]
    };
  }

  async search(query, ctx = {}) {
    await this.mib._ensure();
    const resultado = await this.mib.buscar(query, {
      limite: ctx.limite || 20,
      modoFiscal: ctx.modoFiscal,
      operador_id: ctx.operador_id,
      filial_id: ctx.filial_id,
      caixa_id: ctx.caixa_id
    });
    const itens = (resultado.itens || []).map((p) => ({
      ...p,
      _entity: this.entity
    }));
    return {
      itens,
      meta: {
        ...(resultado.meta || {}),
        provider: this.entity,
        fonte: resultado.meta?.fonte || 'mib'
      }
    };
  }
}

module.exports = ProductProvider;
