'use strict';

const BaseSqlProvider = require('./BaseSqlProvider');

class BrandProvider extends BaseSqlProvider {
  constructor(db) {
    super(db, {
      entity: 'marca',
      aliases: ['marcas', 'fabricante', 'fabricantes', 'brand', 'brands'],
      permissao: 'produtos',
      tabela: 'marcas',
      select: 'id, nome, ativo',
      camposTexto: ['nome'],
      whereBase: 'COALESCE(ativo, 1) = 1',
      orderBy: 'nome ASC'
    });
  }
}

module.exports = BrandProvider;
