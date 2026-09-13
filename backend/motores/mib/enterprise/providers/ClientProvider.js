'use strict';

const BaseSqlProvider = require('./BaseSqlProvider');

class ClientProvider extends BaseSqlProvider {
  constructor(db) {
    super(db, {
      entity: 'cliente',
      aliases: ['clientes', 'client', 'customers'],
      permissao: 'clientes',
      tabela: 'clientes',
      select: 'id, nome, cpf_cnpj, telefone, email, cidade, uf',
      camposTexto: ['nome', 'email', 'cidade'],
      camposNumero: ['cpf_cnpj', 'telefone'],
      orderBy: 'nome ASC'
    });
  }
}

module.exports = ClientProvider;
