'use strict';

const BaseSqlProvider = require('./BaseSqlProvider');

class CategoryProvider extends BaseSqlProvider {
  constructor(db) {
    super(db, {
      entity: 'categoria',
      aliases: ['categorias', 'category', 'categories'],
      permissao: 'categorias',
      tabela: 'categorias',
      select: 'id, nome',
      camposTexto: ['nome'],
      orderBy: 'nome ASC'
    });
  }
}

module.exports = CategoryProvider;
