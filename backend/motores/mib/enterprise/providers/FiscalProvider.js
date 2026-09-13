'use strict';

const ISearchProvider = require('./ISearchProvider');
const { normalizarNomeBusca } = require('../../core/normalizarNomeBusca');

/**
 * Fiscal — CFOP / NCM / CEST / municípios (valores distintos em produtos / clientes).
 */
class FiscalProvider extends ISearchProvider {
  constructor(db) {
    super();
    this.db = db;
  }

  get entity() { return 'fiscal'; }
  get aliases() {
    return ['cfop', 'ncm', 'cest', 'municipio', 'municipios', 'cidade', 'cidades'];
  }
  get permissao() { return 'fiscal'; }

  indexSpec() {
    return {
      tabela: 'produtos',
      indices: [
        'CREATE INDEX IF NOT EXISTS idx_produtos_ncm ON produtos(ncm)',
        'CREATE INDEX IF NOT EXISTS idx_produtos_cfop ON produtos(cfop)'
      ]
    };
  }

  async search(query, ctx = {}) {
    const alias = String(ctx.entityAlias || 'ncm').toLowerCase();
    const termo = String(query || '').trim();
    const limite = Math.min(Math.max(Number(ctx.limite) || 20, 1), 100);
    if (!termo) return { itens: [], meta: { estrategia: 'vazio' } };

    if (alias === 'municipio' || alias === 'municipios' || alias === 'cidade' || alias === 'cidades') {
      return this._buscarCidades(termo, limite);
    }

    const coluna = alias === 'cfop' ? 'cfop' : alias === 'cest' ? 'cest' : 'ncm';
    const like = `%${termo.replace(/%/g, '')}%`;
    const rows = await this._all(
      `SELECT DISTINCT ${coluna} AS codigo
       FROM produtos
       WHERE ${coluna} IS NOT NULL AND TRIM(${coluna}) != '' AND ${coluna} LIKE ?
       ORDER BY ${coluna}
       LIMIT ?`,
      [like, limite]
    );

    // Se coluna cest não existir, SQLite pode falhar — retorna vazio
    const itens = (rows || []).map((r) => ({
      id: r.codigo,
      codigo: r.codigo,
      nome: r.codigo,
      _entity: coluna,
      _score: normalizarNomeBusca(r.codigo).startsWith(normalizarNomeBusca(termo)) ? 80 : 40
    }));

    return {
      itens,
      meta: { estrategia: 'distinct', provider: this.entity, campo: coluna }
    };
  }

  async _buscarCidades(termo, limite) {
    const like = `%${termo.replace(/%/g, '')}%`;
    const rows = await this._all(
      `SELECT DISTINCT cidade AS nome, uf
       FROM clientes
       WHERE cidade IS NOT NULL AND cidade LIKE ?
       ORDER BY cidade
       LIMIT ?`,
      [like, limite]
    );
    return {
      itens: (rows || []).map((r, i) => ({
        id: `${r.nome}-${r.uf || i}`,
        nome: r.nome,
        uf: r.uf,
        _entity: 'municipio',
        _score: 50
      })),
      meta: { estrategia: 'distinct', provider: this.entity, campo: 'cidade' }
    };
  }

  _all(sql, params) {
    return new Promise((resolve) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) resolve([]);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = FiscalProvider;
