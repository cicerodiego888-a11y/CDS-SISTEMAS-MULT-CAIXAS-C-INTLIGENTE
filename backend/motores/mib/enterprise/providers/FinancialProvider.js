'use strict';

const BaseSqlProvider = require('./BaseSqlProvider');
const ISearchProvider = require('./ISearchProvider');

/**
 * Contas a receber (e aliases: contas, centros de custo, plano de contas).
 * Tabelas auxiliares inexistentes retornam vazio sem erro.
 */
class FinancialProvider extends ISearchProvider {
  constructor(db) {
    super();
    this.db = db;
    this._contas = new BaseSqlProvider(db, {
      entity: 'conta',
      aliases: [],
      permissao: 'financeiro',
      tabela: 'contas_receber',
      select: 'id, cliente_id, valor_parcela, valor_restante, status, data_vencimento, numero_parcela',
      camposTexto: ['status'],
      camposNumero: ['cliente_id', 'numero_parcela'],
      orderBy: 'id DESC',
      mapRow: (r) => ({
        id: r.id,
        nome: `Conta #${r.id} · parcela ${r.numero_parcela || '-'} · ${r.status || ''}`,
        cliente_id: r.cliente_id,
        valor: r.valor_parcela,
        valor_restante: r.valor_restante,
        status: r.status,
        data_vencimento: r.data_vencimento
      })
    });
  }

  get entity() { return 'financeiro'; }
  get aliases() {
    return [
      'conta', 'contas', 'centrocusto', 'centro_custo', 'centros_custo',
      'planocontas', 'plano_contas', 'financial'
    ];
  }
  get permissao() { return 'financeiro'; }

  indexSpec() {
    return this._contas.indexSpec();
  }

  async search(query, ctx = {}) {
    const entity = String(ctx.entityAlias || this.entity).toLowerCase();
    // Sem tabelas dedicadas de plano/centro — pesquisa contas_receber
    if (['centrocusto', 'centro_custo', 'centros_custo', 'planocontas', 'plano_contas'].includes(entity)) {
      return {
        itens: [],
        meta: {
          estrategia: 'indisponivel',
          mensagem: 'Entidade sem tabela dedicada nesta instalação',
          provider: this.entity
        }
      };
    }
    const r = await this._contas.search(query, ctx);
    r.itens = (r.itens || []).map((i) => ({ ...i, _entity: 'conta' }));
    r.meta = { ...(r.meta || {}), provider: this.entity };
    return r;
  }
}

module.exports = FinancialProvider;
